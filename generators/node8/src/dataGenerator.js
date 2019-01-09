exports.handler = async (event, context) => {
    const message = `Lambda with ${context.memoryLimitInMB}MB memory invoked at ${new Date()}`
    await sleep(50);
    console.log(message);
    return message;
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}