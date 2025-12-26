import { chromium } from 'playwright';
import fs from 'fs';
import XLSX from 'xlsx';

// ================== CẤU HÌNH ==================
const VIDEO_URL = "https://www.facebook.com/lynhousenew/videos/896882766244966";
const USER_DATA_DIR = "E:\\TOOL\\FACEBOOK\\nodejs\\fb_profile_tool";

// ================== BIẾN TOÀN CỤC ==================
let commentsData = [];
const lastComments = new Map(); // Chống lặp

function saveData() {
    if (commentsData.length === 0) {
        console.log("\nChưa thu thập được comment nào.");
        return;
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);
    const csvFile = `fb_comments_${timestamp}.csv`;
    const xlsxFile = `fb_comments_${timestamp}.xlsx`;

    const csvContent = [
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, `"${c.comment.replace(/"/g, '""')}"`])
    ].map(row => row.join(",")).join("\n");

    fs.writeFileSync(csvFile, '\uFEFF' + csvContent, 'utf8');
    console.log(`\nĐã lưu CSV: ${csvFile}`);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment])
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Comments");
    XLSX.writeFile(wb, xlsxFile);
    console.log(`Đã lưu Excel: ${xlsxFile}`);
}

function printSummary() {
    console.log("\n" + "=".repeat(100));
    console.log(`THU THẬP HOÀN TẤT: ${commentsData.length} COMMENT`);
    console.log("Dữ liệu đã được lưu đầy đủ vào file CSV & Excel.");
    console.log("=".repeat(100));
}

(async () => {
    console.log("FB LIVESTREAM COMMENT COLLECTOR - REALTIME SIÊU CHÍNH XÁC (2025)");
    console.log("Đang mở video... Mọi comment mới sẽ NHẢY TỪNG CÁI MỘT ngay lập tức!\n");

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
                const key = `${uid}_${commentText}`;
                const last = lastComments.get(key);
                if (last && (now - last.time) < 2500) continue;
                lastComments.set(key, { time: now });

                const timeStr = new Date().toTimeString().slice(0, 8);
                const entry = { time: timeStr, user, uid, comment: commentText };
                commentsData.push(entry);

                // === ĐÂY LÀ ĐIỀU BẠN MUỐN: HIỆN NGAY LẬP TỨC, TỪNG CÁI MỘT ===
                console.log(`[${timeStr}] ${user.padEnd(28)} | ${commentText}`);

            }
        } catch (err) {
            // Không in lỗi để màn hình sạch
        }
    });

    await page.evaluate(() => {
        const observer = new MutationObserver(() => {
            // Gọi ngay lập tức, không debounce nữa
            window.collectNewComments();
        });

        const container = document.querySelector('div[role="feed"]') || document.body;
        observer.observe(container, { childList: true, subtree: true });

        console.log("ĐÃ KÍCH HOẠT REALTIME 100%!");
        console.log("Comment mới sẽ NHẢY TỪNG CÁI MỘT giống hệt Facebook!\n");
    });

    process.on('SIGINT', async () => {
        console.log("\n\nĐang dừng và lưu dữ liệu...");
        printSummary();
        saveData();
        console.log("\nHoàn tất! Đóng trình duyệt...");
        await context.close();
        process.exit(0);
    });

    await new Promise(() => {});
})();