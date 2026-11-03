// Fake runner: records calls, answers from a table of `cmd args` prefixes.
function fakeRunner(responses = {}) {
  const calls = [];
  return {
    calls,
    run(cmd, args = []) {
      const line = [cmd, ...args].join(" ");
      calls.push(line);
      const hit = Object.keys(responses).find((prefix) => line.startsWith(prefix));
      const res = hit ? responses[hit] : { code: 0, stdout: "", stderr: "" };
      return { code: 0, stdout: "", stderr: "", ...res };
    },
  };
}
module.exports = { fakeRunner };
