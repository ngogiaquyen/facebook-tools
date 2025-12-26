import { chromium } from 'playwright';
import fs from 'fs';
import XLSX from 'xlsx';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ================== CẤU HÌNH ==================
const VIDEO_URL = "https://www.facebook.com/lynhousenew/videos/896882766244966";
const USER_DATA_DIR = "E:\\TOOL\\FACEBOOK\\nodejs\\fb_profile_tool";
const PORT = 3000;

// Thư mục output
const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Đã tạo thư mục output: ${OUTPUT_DIR}`);
}

const HISTORY_CSV = path.join(OUTPUT_DIR, 'fb_comments_history.csv');

// ================== BIẾN TOÀN CỤC ==================
let commentsData = []; // Session hiện tại
const allTimeComments = new Set(); // Chống trùng lịch sử (dựa trên nội dung comment)
const lastComments = new Map(); // Chống lặp realtime
const exactCommentMap = new Map(); // comment giống y hệt => số lượt (cho Top Bình Chọn)

// Load lịch sử cũ để chống trùng
if (fs.existsSync(HISTORY_CSV)) {
    const content = fs.readFileSync(HISTORY_CSV, 'utf8');
    const lines = content.split('\n').slice(1);
    lines.forEach(line => {
        if (line.trim()) {
            const match = line.match(/"([^"]*)"(?:,$|$)/);
            if (match && match[1]) {
                const comment = match[1].replace(/""/g, '"');
                allTimeComments.add(comment);
            }
        }
    });
    console.log(`Đã load ${allTimeComments.size} comment duy nhất từ lịch sử.`);
}

// ================== WEB SERVER & SOCKET.IO ==================
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });

server.listen(PORT, () => {
    console.log(`\n🌐 Dashboard realtime: http://localhost:${PORT}`);
    console.log(`📁 Dữ liệu lưu tại: ${OUTPUT_DIR}\n`);
});

// ================== TOP BÌNH CHỌN: ĐẾM COMMENT GIỐNG Y HỆT NHAU ==================
function updateVoteRanking(commentText) {
    const trimmed = commentText.trim();
    if (trimmed.length === 0) return;

    const count = (exactCommentMap.get(trimmed) || 0) + 1;
    exactCommentMap.set(trimmed, count);

    // Top 15 comment giống nhau nhiều nhất
    const sorted = Array.from(exactCommentMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

    io.emit('updateTrends', sorted.map(([comment, count]) => ({
        phrase: comment,
        count
    })));
}

// ================== LƯU DỮ LIỆU ==================
function appendToHistory() {
    let csvLines = [];
    const isNewFile = !fs.existsSync(HISTORY_CSV);

    if (isNewFile) {
        csvLines.push(["Thời gian", "Tên người dùng", "UID", "Nội dung comment"]);
    }

    let addedCount = 0;
    commentsData.forEach(c => {
        if (!allTimeComments.has(c.comment)) {
            allTimeComments.add(c.comment);
            const escaped = `"${c.comment.replace(/"/g, '""')}"`;
            csvLines.push([c.time, c.user, c.uid, escaped]);
            addedCount++;
        }
    });

    if (csvLines.length > (isNewFile ? 1 : 0)) {
        const content = csvLines.map(row => row.join(",")).join("\n");
        fs.appendFileSync(HISTORY_CSV, (isNewFile ? '' : '\n') + content, 'utf8');
        console.log(`Đã thêm ${addedCount} comment mới vào lịch sử chung:\n   → ${HISTORY_CSV}`);
    }
}

function saveSnapshot() {
    if (commentsData.length === 0) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);

    // Snapshot Excel
    const xlsxFile = path.join(OUTPUT_DIR, `fb_comments_snapshot_${timestamp}.xlsx`);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment])
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Comments");
    XLSX.writeFile(wb, xlsxFile);
    console.log(`Đã lưu snapshot Excel:\n   → ${xlsxFile}`);

    // Top bình chọn (comment giống nhau)
    const trendsFile = path.join(OUTPUT_DIR, `fb_top_binh_chon_${timestamp}.csv`);
    const sorted = Array.from(exactCommentMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([comment, count], i) => [i + 1, comment, count]);

    if (sorted.length > 0) {
        const csv = [["Xếp hạng", "Nội dung comment", "Số lượt bình chọn"], ...sorted]
            .map(row => row.join(",")).join("\n");
        fs.writeFileSync(trendsFile, '\uFEFF' + csv, 'utf8');
        console.log(`Đã lưu Top Bình Chọn:\n   → ${trendsFile}`);
    }
}

function printSummary() {
    console.log("\n" + "=".repeat(100));
    console.log(`SESSION: ${commentsData.length} comment mới`);
    console.log(`TỔNG LỊCH SỬ: ${allTimeComments.size} comment duy nhất`);
    console.log(`TOP BÌNH CHỌN: ${exactCommentMap.size} mẫu comment khác nhau`);
    console.log(`Tất cả file đã lưu trong: ${OUTPUT_DIR}`);
    console.log("=".repeat(100));
}

// ================== PLAYWRIGHT SCRAPER ==================
(async () => {
    console.log("🏆 FB CUỘC THI BÌNH CHỌN - TOP COMMENT GIỐNG NHAU REALTIME (2025)");

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 1366, height: 768 },
        args: ["--start-maximized", "--disable-blink-features=AutomationControlled"]
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);

    await page.exposeFunction('collectNewComments', async () => {
        try {
            const commentElements = await page.$$(`
                div[role="article"][aria-label^="Comment"],
                div[role="article"][aria-label^="Bình luận"],
                div.x1n2onr6 div[role="article"],
                div.x1yztbdb div[role="article"],
                div[data-ad-comet-preview="message"],
                div.xwib8y2.xpdmqnj.x1g0dm76.x1y1aw1k
            `);

            for (const el of commentElements) {
                const alreadyProcessed = await el.evaluate(node => node.dataset.processed === 'true');
                if (alreadyProcessed) continue;
                await el.evaluate(node => node.dataset.processed = 'true');

                let user = "Unknown";
                const nameEl = await el.$('a[role="link"] span.x193iq5w.xeuugli[dir="auto"], a[role="link"] strong span, span.x193iq5w.xeuugli[dir="auto"] > span');
                if (nameEl) user = (await nameEl.innerText()).trim();

                let uid = "Unknown";
                const profileLink = await el.$('a[role="link"][href*="facebook.com/"]:not([href*="comment_id"])');
                if (profileLink) {
                    const href = await profileLink.getAttribute('href');
                    const match = href.match(/\/(profile\.php\?id=|user\/|people\/[^\/]+\/)(\d+)/);
                    if (match) uid = match[2];
                }

                let commentText = "";
                const realTextEl = await el.$('div[dir="auto"][style*="text-align: start"] > div[dir="auto"]');
                if (realTextEl) {
                    commentText = (await realTextEl.innerText()).trim();
                }

                if (!commentText) {
                    const fallbackEls = await el.$$('span[dir="auto"]:not(:has(a)):not(:has(strong)), div[dir="auto"]:not(:has(a)):not(:has(strong))');
                    for (const f of fallbackEls) {
                        const txt = (await f.innerText()).trim();
                        if (txt && txt.length > 0 && txt !== user && txt !== "Follow") {
                            commentText = txt;
                            break;
                        }
                    }
                }

                if (commentText.length < 1 || commentText === "Follow") continue;

                const now = Date.now();
                const key = `${uid}_${commentText.substring(0, 50)}`;
                const last = lastComments.get(key);
                if (last && (now - last.time) < 2500) continue;
                lastComments.set(key, { time: now });

                const timeStr = new Date().toTimeString().slice(0, 8);
                const entry = { time: timeStr, user, uid, comment: commentText };
                commentsData.push(entry);

                console.log(`[${timeStr}] ${user.padEnd(28)} | ${commentText}`);
                io.emit('newComment', { time: timeStr, user, comment: commentText });

                // Cập nhật Top Bình Chọn: đếm comment giống y hệt
                updateVoteRanking(commentText);
            }
        } catch (err) {
            // Silent
        }
    });

    await page.evaluate(() => {
        const observer = new MutationObserver(() => window.collectNewComments());
        const container = document.querySelector('div[role="feed"]') || document.body;
        observer.observe(container, { childList: true, subtree: true });
    });

    process.on('SIGINT', async () => {
        console.log("\n\nĐang lưu dữ liệu và dừng chương trình...");
        appendToHistory();
        saveSnapshot();
        printSummary();
        await context.close();
        process.exit(0);
    });

    await new Promise(() => {});
})();