const nodeMajor = Number.parseInt(process.versions.node.split(".", 1)[0], 10);

if (nodeMajor !== 24) {
  console.error(
    `Node 24 is required; current runtime is Node ${process.versions.node}. ` +
    "Switch to the version from .node-version and reinstall dependencies.",
  );
  process.exit(1);
}
