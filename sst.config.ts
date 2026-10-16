/// <reference path="./.sst/platform/config.d.ts" />

// SenseAgri dashboard on Lambda + CloudFront in Cape Town.
//
// IAM for the server function is created here (least privilege for the resources
// the app actually calls). GitHub OIDC, the deploy role, and the permissions
// boundary live in infra/cloudformation/github-oidc-deploy-role.yaml. The
// boundary policy name must stay senseagri-dashboard-permissions-boundary.
//
// Do not set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY. The AWS SDK then uses the
// Lambda execution role. Those env vars are reserved on Lambda anyway.
//
// OpenNext is pinned: SST 3.19 defaults to OpenNext 3.9.14, whose peer range does
// not accept Next.js 16. @opennextjs/aws 4.1.10 requires next >= 16.3.8.

const REGION = "af-south-1";

// ffmpeg-static 5.3 publishes a linux-arm64 binary (install.js selects it from
// os.arch(), or from npm_config_platform / npm_config_arch). The deploy workflow
// runs on an ARM runner so the binary that lands in node_modules matches Lambda.
const SERVER_ARCHITECTURE = "arm64" as const;

export default $config({
  app(input) {
    return {
      name: "senseagri-dashboard",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: { region: REGION },
      },
    };
  },
  async run() {
    const { accountId } = await aws.getCallerIdentity({});

    // The deploy role refuses to create a role unless this boundary is set.
    const boundaryArn = `arn:aws:iam::${accountId}:policy/senseagri-dashboard-permissions-boundary`;
    $transform(aws.iam.Role, (args) => {
      args.permissionsBoundary = boundaryArn;
    });

    // SST's generated names are truncated and do not keep the
    // senseagri-dashboard- prefix the deploy role allows. Pin the function
    // and role names. Lambda names also fix the log group path.
    const stagePrefix = `senseagri-dashboard-${$app.stage}`;
    const awsName = (suffix: string) => {
      const value = `${stagePrefix}-${suffix}`;
      if (value.length > 64) {
        throw new Error(`AWS name is longer than 64 characters: ${value}`);
      }
      return value;
    };
    const scopeFunction = (functionSuffix: string, roleSuffix: string) => {
      return (args: {
        name?: string;
        transform?: {
          role?: (
            roleArgs: { name?: string; permissionsBoundary?: string },
            opts: unknown,
            name: string,
          ) => void;
        };
      }) => {
        args.name = awsName(functionSuffix);
        const previous = args.transform?.role;
        args.transform = {
          ...args.transform,
          role: (roleArgs, opts, name) => {
            if (typeof previous === "function") previous(roleArgs, opts, name);
            roleArgs.name = awsName(roleSuffix);
            roleArgs.permissionsBoundary = boundaryArn;
          },
        };
      };
    };

    const clerkPublishableKey = new sst.Secret("ClerkPublishableKey");
    const clerkSecretKey = new sst.Secret("ClerkSecretKey");
    const vapidPublicKey = new sst.Secret("VapidPublicKey");
    const vapidPrivateKey = new sst.Secret("VapidPrivateKey");
    const vapidSubject = new sst.Secret("VapidSubject");

    const ssm = (suffix: string) =>
      `arn:aws:ssm:${REGION}:${accountId}:parameter/${suffix}`;
    const table = (name: string) =>
      `arn:aws:dynamodb:${REGION}:${accountId}:table/${name}`;
    const glue = (resource: string) =>
      `arn:aws:glue:${REGION}:${accountId}:${resource}`;

    const silverBucket = "senseagri-dev-silver";
    const athenaResultsBucket = "senseagri-dev-athena-results";
    const mediaBucket = "senseagri-dev-media-inference";
    const rawBucket = "senseagri-dev-raw";
    const pushTable = "senseagri-dev-push-subscriptions";
    const alertsTable = "senseagri-dev-alerts";

    new sst.aws.Nextjs("Dashboard", {
      openNextVersion: "4.1.10",
      link: [clerkPublishableKey, clerkSecretKey, vapidPublicKey, vapidPrivateKey, vapidSubject],
      // NEXT_PUBLIC_* values are inlined into the browser bundle by Next at build
      // time. Only the publishable Clerk key and the VAPID public key are public.
      // CLERK_SECRET_KEY and VAPID_PRIVATE_KEY are server-only SST secrets.
      environment: {
        INFLUXDB_URL: "https://us-east-1-1.aws.cloud2.influxdata.com",
        INFLUXDB_BUCKET: "senseagri-telemetry",
        PUSH_TABLE: pushTable,
        ALERTS_TABLE: alertsTable,
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey.value,
        CLERK_SECRET_KEY: clerkSecretKey.value,
        NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublicKey.value,
        VAPID_PRIVATE_KEY: vapidPrivateKey.value,
        VAPID_SUBJECT: vapidSubject.value,
      },
      server: {
        architecture: SERVER_ARCHITECTURE,
        // CloudFront's default origin timeout ceiling is 60 seconds. SST applies
        // this to both the Lambda timeout and the CloudFront origin read timeout.
        // /api/egg-count/clip-stream sets maxDuration = 60.
        timeout: "60 seconds",
        // Shared by every server route, including the ffmpeg clip transcode.
        memory: "1536 MB",
        runtime: "nodejs22.x",
        install: ["ffmpeg-static"],
      },
      permissions: [
        {
          actions: ["ssm:GetParameter", "ssm:GetParameters"],
          resources: [ssm("senseagri/dev/*")],
        },
        {
          actions: ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
          resources: [ssm("senseagri/farms"), ssm("senseagri/farms/*")],
        },
        {
          actions: ["ssm:PutParameter"],
          resources: [ssm("senseagri/farms/*")],
        },
        {
          // SecureString decrypt when the exact KMS key id is not in this repo.
          // The call has to come from SSM in this region. A customer-managed key
          // still needs a key policy that trusts this role.
          actions: ["kms:Decrypt"],
          resources: ["*"],
          conditions: [
            {
              test: "StringEquals",
              variable: "kms:ViaService",
              values: [`ssm.${REGION}.amazonaws.com`],
            },
          ],
        },
        {
          actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
          ],
          resources: [`arn:aws:athena:${REGION}:${accountId}:workgroup/senseagri`],
        },
        {
          actions: [
            "glue:GetDatabase",
            "glue:GetTable",
            "glue:GetPartition",
            "glue:GetPartitions",
            "glue:BatchGetPartition",
          ],
          resources: [
            glue("catalog"),
            glue("database/senseagri_silver"),
            glue("table/senseagri_silver/aligned_hourly"),
            glue("table/senseagri_silver/meters_hourly"),
          ],
        },
        {
          actions: ["s3:ListBucket", "s3:GetBucketLocation"],
          resources: [`arn:aws:s3:::${silverBucket}`, `arn:aws:s3:::${athenaResultsBucket}`],
        },
        {
          actions: ["s3:GetObject"],
          resources: [`arn:aws:s3:::${silverBucket}/*`],
        },
        {
          actions: ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"],
          resources: [`arn:aws:s3:::${athenaResultsBucket}/*`],
        },
        {
          actions: ["s3:ListBucket"],
          resources: [`arn:aws:s3:::${mediaBucket}`],
          conditions: [
            {
              test: "StringLike",
              variable: "s3:prefix",
              values: ["clips/*", "events/audio/*"],
            },
          ],
        },
        {
          actions: ["s3:GetObject"],
          resources: [
            `arn:aws:s3:::${mediaBucket}/clips/*`,
            `arn:aws:s3:::${mediaBucket}/events/audio/*`,
          ],
        },
        {
          actions: ["s3:ListBucket"],
          resources: [`arn:aws:s3:::${rawBucket}`],
          conditions: [
            {
              test: "StringLike",
              variable: "s3:prefix",
              values: ["raw/events/*"],
            },
          ],
        },
        {
          actions: ["s3:GetObject"],
          resources: [`arn:aws:s3:::${rawBucket}/raw/events/*`],
        },
        {
          actions: ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:Query"],
          resources: [table(pushTable)],
        },
        {
          actions: ["dynamodb:Query"],
          resources: [table(alertsTable)],
        },
      ],
      transform: {
        server: scopeFunction("server", "server-role"),
        imageOptimizer: scopeFunction("image", "image-role"),
        revalidationEventsSubscriber: scopeFunction("revalidate", "revalidate-role"),
        revalidationSeeder: scopeFunction("seed", "seed-role"),
      },
    });
  },
});
