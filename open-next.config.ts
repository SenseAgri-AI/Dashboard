// Turns on Lambda response streaming for the OpenNext server function.
// SST reads this from the OpenNext build output and sets the function URL
// invoke mode to RESPONSE_STREAM. Ordinary JSON routes still return normally.
// The assistant route does not stream today; this keeps that path available.

const config = {
  default: {
    override: {
      wrapper: "aws-lambda-streaming",
    },
  },
};

export default config;
