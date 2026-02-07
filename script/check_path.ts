
import fs from "fs";
const p = "/home/user/moj_judgments/judgments_antigravity.csv";
try {
    if (fs.existsSync(p)) {
        console.log("EXISTS");
    } else {
        console.log("NOT_FOUND");
    }
} catch (e) {
    console.log("ERROR", e.message);
}
