const fs = require("fs");
const path = require("path");

const shimName = "firebase-admin-a14c8a5423a75469";
const targetDir = path.join(__dirname, "..", "node_modules", shimName);

const ensureDir = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

ensureDir(targetDir);

const pkg = {
  name: shimName,
  version: "1.0.0",
  type: "module",
  exports: {
    "./app": "./app.js",
    "./firestore": "./firestore.js",
  },
};

fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2));
fs.writeFileSync(path.join(targetDir, "app.js"), "export * from \"firebase-admin/app\";\n");
fs.writeFileSync(path.join(targetDir, "firestore.js"), "export * from \"firebase-admin/firestore\";\n");
