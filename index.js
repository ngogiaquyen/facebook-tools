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

// ================== BIẾN TOÀN CỤC ==================
let commentsData = [];
const lastComments = new Map(); // Chống lặp
const trendMap = new Map(); // phrase => count

// ================== WEB SERVER & SOCKET.IO ==================
const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Tạo thư mục public và file index.html nếu chưa có
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
}

server.listen(PORT, () => {
    console.log(`\n🌐 Web dashboard đang chạy tại: http://localhost:${PORT}`);
    console.log(`Mở trình duyệt để xem realtime comments & trends!\n`);
});

// ================== HÀM XỬ LÝ TRENDS ==================
function normalizePhrase(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Giữ chữ cái, số và khoảng trắng (hỗ trợ tiếng Việt)
        .replace(/\s+/g, ' ')
        .trim();
}

function updateTrends(commentText) {
    const normalized = normalizePhrase(commentText);
    const words = normalized.split(' ');

    const phrases = [];
    for (let len = 2; len <= 4; len++) {
        for (let i = 0; i <= words.length - len; i++) {
            const phrase = words.slice(i, i + len).join(' ');
            if (phrase.length >= 4) {
                phrases.push(phrase);
            }
        }
    }

    phrases.forEach(phrase => {
        trendMap.set(phrase, (trendMap.get(phrase) || 0) + 1);
    });

    // Top 20 trends để gửi về client
    const sorted = Array.from(trendMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);

    io.emit('updateTrends', sorted.map(([phrase, count]) => ({ phrase, count })));
}

// ================== LƯU DỮ LIỆU ==================
function saveData() {
    if (commentsData.length === 0) {
        console.log("\nChưa thu thập được comment nào.");
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);

    // Lưu comments
    const csvFile = `fb_comments_${timestamp}.csv`;
    const xlsxFile = `fb_comments_${timestamp}.xlsx`;

    const csvContent = [
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, `"${c.comment.replace(/"/g, '""')}"`])
    ].map(row => row.join(",")).join("\n");

    fs.writeFileSync(csvFile, '\uFEFF' + csvContent, 'utf8');
    console.log(`Đã lưu CSV comments: ${csvFile}`);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment])
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Comments");
    XLSX.writeFile(wb, xlsxFile);
    console.log(`Đã lưu Excel comments: ${xlsxFile}`);

    // Lưu trends
    const trendsFile = `fb_trends_${timestamp}.csv`;
    const sortedTrends = Array.from(trendMap.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([phrase, count], index) => ({ rank: index + 1, phrase, count }));

    if (sortedTrends.length > 0) {
        const trendsCsv = [
            ["Xếp hạng", "Cụm từ hot", "Số lần xuất hiện"],
            ...sortedTrends.map(t => [t.rank, t.phrase, t.count])
        ].map(row => row.join(",")).join("\n");

        fs.writeFileSync(trendsFile, '\uFEFF' + trendsCsv, 'utf8');
        console.log(`Đã lưu CSV trends: ${trendsFile}`);
    }
}

function printSummary() {
    console.log("\n" + "=".repeat(100));
    console.log(`THU THẬP HOÀN TẤT: ${commentsData.length} COMMENT DUY NHẤT`);
    console.log(`Đã phát hiện ${trendMap.size} cụm từ hot khác nhau`);
    console.log("=".repeat(100));
}

// ================== PLAYWRIGHT SCRAPER ==================
(async () => {
    console.log("🚀 FB LIVESTREAM COMMENT COLLECTOR PRO - REALTIME + DASHBOARD (2025)");
    console.log("Đang mở video và chuẩn bị thu thập...\n");

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
                const mainTextEl = await el.$('div[dir="auto"][style*="text-align: start"] > div[dir="auto"]');
                if (mainTextEl) {
                    commentText = (await mainTextEl.innerText()).trim();
                } else {
                    const fallbackEls = await el.$$('span[dir="auto"]:not(:has(a)):not(:has(strong)), div[dir="auto"]:not(:has(a)):not(:has(strong))');
                    for (const f of fallbackEls) {
                        const txt = (await f.innerText()).trim();
                        if (txt && txt.length > 0 && txt !== user) {
                            commentText = txt;
                            break;
                        }
                    }
                }

                if (commentText.length < 1) continue;

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
                updateTrends(commentText);
            }
        } catch (err) {
            // Silent
        }
    });

    await page.evaluate(() => {
        const observer = new MutationObserver(() => {
            window.collectNewComments();
        });
        const container = document.querySelector('div[role="feed"]') || document.body;
        observer.observe(container, { childList: true, subtree: true });
        console.log("Observer đã kích hoạt - realtime 100%!");
    });

    process.on('SIGINT', async () => {
        console.log("\n\nĐang dừng và lưu toàn bộ dữ liệu...");
        printSummary();
        saveData();
        await context.close();
        process.exit(0);
    });

    await new Promise(() => {});
})();