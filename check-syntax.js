const parser = require("@babel/parser");
const fs = require("fs");

const code = fs.readFileSync("src/app/admin/users/page.tsx", "utf-8");

try {
  parser.parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  console.log("Syntax OK");
} catch (e) {
  console.error("Syntax Error:", e.message);
  console.error("Location:", e.loc);
}