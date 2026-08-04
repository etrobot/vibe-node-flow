// SEA entry point — sets an uncommon port to avoid conflicts
process.env.PORT = process.env.PORT || "39741";
// Delegate to the bundled server
require("./server.cjs");