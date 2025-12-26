import { chromium } from 'playwright';
import fs from 'fs';
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

const OUTPUT_DIR = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}
const HISTORY_CSV = path.join(OUTPUT_DIR, 'fb_comments_history.csv');

// ================== BIẾN TOÀN CỤC ==================
let commentsData = [];
const allTimeComments = new Set();
const lastComments = new Map();
const exactCommentMap = new Map();
const commentsContainingKeyword = new Map();
let historyComments = []; // MỚI: Lưu toàn bộ comment lịch sử theo thứ tự thời gian

let io;

// ================== HÀM GỬI TOP TRENDS CHO TẤT CẢ CLIENT ==================
function broadcastTrends() {
    const allTrends = Array.from(exactCommentMap.entries())
        .filter(([_, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([comment, count]) => ({ phrase: comment, count }));
    io.emit('updateTrends', allTrends);
}

// ================== LOAD DỮ LIỆU TỪ FILE LỊCH SỬ ==================
function loadHistoryForDashboard() {
    historyComments = []; // Reset

    if (!fs.existsSync(HISTORY_CSV)) {
        console.log("Chưa có file lịch sử → bắt đầu mới.");
        io.emit('loadHistoryComments', []);
        broadcastTrends();
        return;
    }

    const content = fs.readFileSync(HISTORY_CSV, 'utf8');
    const lines = content.split('\n');

    let loaded = 0;
    let started = false;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        if (!started && line.startsWith("Thời gian")) {
            started = true;
            continue;
        }
        if (!started) continue;

        // Split CSV thông minh (xử lý dấu phẩy trong nội dung quote)
        const parts = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
        if (parts.length < 4) continue;

        let time = parts[0].replace(/^"|"$/g, '').trim();
        let user = parts[1].replace(/^"|"$/g, '').trim();
        let uid = parts[2].replace(/^"|"$/g, '').trim();
        let commentText = parts.slice(3).join(',').replace(/^"|"$/g, '').replace(/""/g, '"').trim();

        if (!commentText) continue;

        loaded++;
        allTimeComments.add(commentText);
        exactCommentMap.set(commentText, (exactCommentMap.get(commentText) || 0) + 1);

        // Lưu vào historyComments (mới nhất trước)
        historyComments.unshift({ time, user, uid, comment: commentText });

        // Cập nhật từ khóa
        const words = commentText.toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(w => w.length >= 1);

        words.forEach(word => {
            if (!commentsContainingKeyword.has(word)) commentsContainingKeyword.set(word, new Map());
            const m = commentsContainingKeyword.get(word);
            m.set(commentText, (m.get(commentText) || 0) + 1);
        });

        const fullLower = commentText.toLowerCase();
        if (!commentsContainingKeyword.has(fullLower)) commentsContainingKeyword.set(fullLower, new Map());
        commentsContainingKeyword.get(fullLower).set(commentText,
            (commentsContainingKeyword.get(fullLower).get(commentText) || 0) + 1);
    }

    console.log(`Đã load ${loaded} comment duy nhất từ lịch sử!`);
    console.log(`Top mẫu hiện có: ${exactCommentMap.size}`);

    // Gửi lịch sử cho tất cả client đang kết nối
    io.emit('loadHistoryComments', historyComments.slice(0, 500));
    broadcastTrends();
}

// ================== WEB SERVER & SOCKET.IO ==================
const app = express();
const server = createServer(app);
io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

if (!fs.existsSync(path.join(__dirname, 'public'))) {
    fs.mkdirSync(path.join(__dirname, 'public'), { recursive: true });
}

io.on('connection', (socket) => {
    console.log('Client kết nối dashboard');

    // Gửi ngay lịch sử comment và top trends cho client mới
    socket.emit('loadHistoryComments', historyComments.slice(0, 500));
    broadcastTrends();

    socket.on('searchKeyword', (query) => {
        const keyword = query.trim().toLowerCase();
        if (!keyword) {
            socket.emit('searchResult', { total: 0, results: [], keyword: query });
            return;
        }

        if (!commentsContainingKeyword.has(keyword)) {
            socket.emit('searchResult', { total: 0, results: [], keyword: query });
            return;
        }

        const map = commentsContainingKeyword.get(keyword);
        const results = Array.from(map.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([comment, count]) => ({ comment, count }));

        const total = results.reduce((s, r) => s + r.count, 0);
        socket.emit('searchResult', { keyword: query, total, results });
    });
});

server.listen(PORT, () => {
    console.log(`\n🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`📁 File lịch sử duy nhất: ${HISTORY_CSV}\n`);
    loadHistoryForDashboard(); // Load lịch sử ngay khi server chạy
});

// ================== CẬP NHẬT TOP KHI CÓ COMMENT MỚI ==================
function updateVoteRanking(commentText) {
    const trimmed = commentText.trim();
    if (!trimmed) return;
    exactCommentMap.set(trimmed, (exactCommentMap.get(trimmed) || 0) + 1);
    broadcastTrends();
}

function updateKeywordIndex(commentText) {
    const trimmed = commentText.trim();
    if (!trimmed) return;

    const words = trimmed.toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 2);

    words.forEach(word => {
        if (!commentsContainingKeyword.has(word)) commentsContainingKeyword.set(word, new Map());
        const m = commentsContainingKeyword.get(word);
        m.set(trimmed, (m.get(trimmed) || 0) + 1);
    });

    const full = trimmed.toLowerCase();
    if (!commentsContainingKeyword.has(full)) commentsContainingKeyword.set(full, new Map());
    commentsContainingKeyword.get(full).set(trimmed, (commentsContainingKeyword.get(full).get(trimmed) || 0) + 1);
}

// ================== LƯU VÀO FILE LỊCH SỬ ==================
function appendNewCommentsToHistory() {
    if (commentsData.length === 0) return;

    let lines = [];
    const isNew = !fs.existsSync(HISTORY_CSV);
    if (isNew) lines.push(["Thời gian", "Tên người dùng", "UID", "Nội dung comment"]);

    let added = 0;
    commentsData.forEach(c => {
        if (!allTimeComments.has(c.comment)) {
            allTimeComments.add(c.comment);
            const escaped = `"${c.comment.replace(/"/g, '""')}"`;
            lines.push([c.time, c.user, c.uid, escaped]);
            added++;
        }
    });

    if (lines.length > (isNew ? 1 : 0)) {
        const content = lines.map(r => r.join(",")).join("\n");
        fs.appendFileSync(HISTORY_CSV, (isNew ? '' : '\n') + content, 'utf8');
        console.log(`Đã thêm ${added} comment mới vào lịch sử.`);
    }
}

function printSummary() {
    console.log("\n" + "=".repeat(80));
    console.log(`SESSION: ${commentsData.length} comment mới`);
    console.log(`TỔNG: ${allTimeComments.size} comment duy nhất`);
    console.log(`TOP MẪU: ${exactCommentMap.size}`);
    console.log(`TỪ KHÓA: ${commentsContainingKeyword.size}`);
    console.log("=".repeat(80));
}

// ================== PLAYWRIGHT SCRAPER ==================
(async () => {
    console.log("🏆 FB COMMENT TRACKER - LOAD LỊCH SỬ + REALTIME (2025)");

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
                if (await el.evaluate(n => n.dataset.processed === 'true')) continue;
                await el.evaluate(n => n.dataset.processed = 'true');

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
                const realEl = await el.$('div[dir="auto"][style*="text-align: start"] > div[dir="auto"]');
                if (realEl) commentText = (await realEl.innerText()).trim();

                if (!commentText) {
                    const falls = await el.$$('span[dir="auto"]:not(:has(a)):not(:has(strong)), div[dir="auto"]:not(:has(a)):not(:has(strong))');
                    for (const f of falls) {
                        const t = (await f.innerText()).trim();
                        if (t && t.length > 0 && t !== user && t !== "Follow") {
                            commentText = t;
                            break;
                        }
                    }
                }

                if (!commentText || commentText === "Follow") continue;

                const now = Date.now();
                const key = `${uid}_${commentText.substring(0, 50)}`;
                if (lastComments.has(key) && now - lastComments.get(key) < 2500) continue;
                lastComments.set(key, now);

                const timeStr = new Date().toTimeString().slice(0, 8);
                const entry = { time: timeStr, user, uid, comment: commentText };
                commentsData.push(entry);

                console.log(`[${timeStr}] ${user.padEnd(28)} | ${commentText}`);
                io.emit('newComment', { time: timeStr, user, comment: commentText });

                updateVoteRanking(commentText);
                updateKeywordIndex(commentText);
            }
        } catch (err) {
            console.error("Lỗi collect comments:", err);
        }
    });

    await page.evaluate(() => {
        const observer = new MutationObserver(() => window.collectNewComments());
        const container = document.querySelector('div[role="feed"]') || document.body;
        observer.observe(container, { childList: true, subtree: true });
    });

    process.on('SIGINT', async () => {
        console.log("\n\nĐang lưu và dừng...");
        appendNewCommentsToHistory();
        printSummary();
        await context.close();
        process.exit(0);
    });

    await new Promise(() => {});
})();