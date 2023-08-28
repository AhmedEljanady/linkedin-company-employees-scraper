const fs = require("fs");
const jsondiffpatch = require("jsondiffpatch");

// Load JSON data from files
const file1Data = fs.readFileSync("profiles.json", "utf8");
const file2Data = fs.readFileSync("profiles1.json", "utf8");

const json1 = JSON.parse(file1Data);
const json2 = JSON.parse(file2Data);

// Compute the difference between JSON objects
const delta = jsondiffpatch.diff(json1, json2);

// Output the differences
console.log("Differences between file1.json and file2.json:");
console.log(jsondiffpatch.formatters.console.format(delta, json1));
