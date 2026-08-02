import { randomBytes } from "node:crypto";


const baseUrl = String(process.argv[2] || "https://YOUR-DOMAIN.example").replace(/\/$/, "");
const participants = [
  ["P01", "consulted"],
  ["P02", "consulted"],
  ["P03", "consulted"],
  ["P04", "new"],
  ["P05", "new"],
  ["P06", "new"]
];

const invites = {};
const links = participants.map(([participantCode, cohort]) => {
  const token = randomBytes(18).toString("base64url");
  invites[token] = { participantCode, cohort };
  return `${participantCode}\t${baseUrl}/?invite=${token}`;
});

console.log("INVITE_CODES_JSON=" + JSON.stringify(invites));
console.log("\n学员链接（每人只发对应的一条）：");
console.log(links.join("\n"));
