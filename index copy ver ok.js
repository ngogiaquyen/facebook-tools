const { chromium } = require('playwright');
const fs = require('fs');
const XLSX = require('xlsx');

// ================== CẤU HÌNH ==================
const VIDEO_URL = "https://www.facebook.com/jayed973/videos/893195033386431";
const USER_DATA_DIR = "D:/temp/v2/modules"; // Đường dẫn profile
const CHOT_DON_REGEX = /\b(\d{2,3})\b|chốt|chot|size|đơn|ib|inbox|m|l|xl|xxl|64|63|60|số|so/i;

let commentsData = [];
let processedComments = new Set(); // Tránh trùng (key: uid-text)

// Beep
function beep() {
    process.stdout.write('\x07');
    process.stdout.write('\x07');
    process.stdout.write('\x07');
}

// Highlight chốt đơn / SĐT
function highlight(text, user, uid) {
    if (CHOT_DON_REGEX.test(text)) {
        console.log(`🚨🚨🚨 CHỐT ĐƠN: "${text}" - ${user} (UID: ${uid})`);
        beep();
    }
    const phones = text.match(/0[3-9]\d{8}/g);
    if (phones) {
        console.log(`📱📱 SĐT: ${phones.join(', ')} - ${user} (UID: ${uid})`);
        beep();
    }
}

// In bảng comment mới
function printNewCommentsTable(newEntries) {
    if (newEntries.length === 0) return;

    console.log("\n" + "=".repeat(120));
    console.log("🆕 COMMENT MỚI (REALTIME - MUTATIONOBSERVER)");
    console.log("=".repeat(120));
    console.log(`${"STT".padEnd(4)} ${"Thời gian".padEnd(12)} ${"Tên người".padEnd(25)} ${"UID".padEnd(18)} Comment`);
    console.log("-".repeat(120));

    const startIdx = commentsData.length - newEntries.length + 1;
    newEntries.forEach((entry, i) => {
        const idx = startIdx + i;
        const user = entry.user.substring(0, 24).padEnd(25);
        const comment = entry.comment.replace(/\r?\n/g, " ");
        console.log(`${String(idx).padEnd(4)} ${entry.time.padEnd(12)} ${user} ${entry.uid.padEnd(18)} ${comment}`);
    });

    console.log("-".repeat(120));
    console.log(`📊 Tổng cộng đã thu thập: ${commentsData.length} comment\n`);
}

// In tổng hợp khi dừng
function printFullResultsTable() {
    // ... (giữ nguyên như trước)
    if (commentsData.length === 0) {
        console.log("\nChưa có comment nào được thu thập.");
        return;
    }

    console.log("\n" + "=".repeat(120));
    console.log("📋 TỔNG HỢP TOÀN BỘ COMMENT");
    console.log("=".repeat(120));
    console.log(`${"STT".padEnd(4)} ${"Thời gian".padEnd(12)} ${"Tên người".padEnd(25)} ${"UID".padEnd(18)} Comment`);
    console.log("-".repeat(120));

    commentsData.forEach((entry, i) => {
        const user = entry.user.substring(0, 24).padEnd(25);
        const comment = entry.comment.replace(/\r?\n/g, " ");
        console.log(`${String(i + 1).padEnd(4)} ${entry.time.padEnd(12)} ${user} ${entry.uid.padEnd(18)} ${comment}`);
    });

    console.log("-".repeat(120));
    console.log(`Tổng cộng: ${commentsData.length} comment\n`);
}

// Lưu CSV + Excel (giữ nguyên)
function saveData() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);
    const csvFile = `ninja_comments_${timestamp}.csv`;

    const csvContent = [
        ["time", "user", "uid", "comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment.replace(/,/g, ' ')])
    ].map(e => e.join(",")).join("\n");

    fs.writeFileSync(csvFile, '\uFEFF' + csvContent, 'utf8');
    console.log(`   → ${csvFile} (CSV)`);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
        ["time", "user", "uid", "comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment])
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Comments");
    const xlsxFile = `ninja_comments_${timestamp}.xlsx`;
    XLSX.writeFile(wb, xlsxFile);
    console.log(`   → ${xlsxFile} (Excel)`);
}

(async () => {
    console.log("🚀 NINJA COMMENT CLONE – REALTIME KHÔNG DÙNG SETINTERVAL (MutationObserver 2025)");

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 1366, height: 768 },
        ignoreDefaultArgs: ["--enable-automation"],
        args: [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-web-security",
            "--allow-running-insecure-content",
            "--disable-features=IsolateOrigins,site-per-process",
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ]
    });

    const page = context.pages()[0] || await context.newPage();

    await page.goto(VIDEO_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(15000); // Đợi load video + comment ban đầu

    console.log("\n=== BẮT ĐẦU QUÉT COMMENT REALTIME (KHÔNG POLLING - CHỈ KHI CÓ THAY ĐỔI DOM) ===");
    console.log("Ctrl + C để dừng và lưu file.\n");

    // Selector rộng nhất có thể cho container comment (cập nhật 2025)
    const COMMENT_CONTAINER_SELECTOR = 'div[role="feed"], div.x1e56ztr, div.x78zum5, div.x1yztbdb, article, div[role="main"]';

    // Hàm xử lý comment mới (gọi từ page.evaluate)
    await page.exposeFunction('processNewComments', async () => {
        try {
            // Scroll nhẹ + click load more để trigger thêm comment
            await page.evaluate(() => {
                window.scrollBy(0, 800);
                document.querySelectorAll('div[role="button"]').forEach(btn => {
                    const text = btn.innerText.toLowerCase();
                    if (text.includes('view more comments') || text.includes('xem thêm bình luận') ||
                        text.includes('view more replies') || text.includes('xem thêm câu trả lời')) {
                        btn.click();
                    }
                });
            });

            // Selector robust cho từng comment
            const comments = await page.$$('div[role="article"][aria-label^="Comment"], div[role="article"] > div > div > div > div[dir="auto"], div.x1n2onr6 div[role="article"], div.x1yztbdb div.x1n2onr6 div[role="article"]');

            const newEntries = [];

            for (const el of comments) {
                try {
                    // Username
                    let name = "Unknown";
                    const nameEl = await el.$('a[role="link"] strong span, a[role="link"] span strong, h3 span, span[dir="auto"] > strong > span');
                    if (nameEl) name = (await nameEl.innerText()).trim();

                    // UID
                    let uid = "Unknown";
                    const avatar = await el.$('a[role="link"][href*="facebook.com/"]');
                    if (avatar) {
                        const href = await avatar.getAttribute('href');
                        const match = href.match(/(user|profile\.php\?id|people\/[^\/]+)\/(\d+)/);
                        if (match) uid = match[2];
                    }

                    // Text comment
                    let text = "";
                    const textEls = await el.$$('div[dir="auto"]:not(:has(a)):not(:has(div[role="button"]))');
                    for (const t of textEls) {
                        const tText = await t.innerText();
                        if (tText.trim().length > 2) {
                            text = tText.trim();
                            break;
                        }
                    }

                    if (!text) continue;

                    const key = `${uid}-${text.substring(0, 50)}`;
                    if (processedComments.has(key)) continue;
                    processedComments.add(key);

                    const timeStr = new Date().toTimeString().slice(0, 8);
                    const entry = { time: timeStr, user: name, uid, comment: text };
                    commentsData.push(entry);
                    newEntries.push(entry);

                    highlight(text, name, uid);

                } catch (e) {}
            }

            if (newEntries.length > 0) {
                printNewCommentsTable(newEntries);
            }
        } catch (e) {
            console.error("Lỗi xử lý comment:", e);
        }
    });

    // Thiết lập MutationObserver trong page
    await page.evaluate(() => {
        const container = document.querySelector('div[role="feed"]') || document.body;

        const observer = new MutationObserver(async () => {
            // Khi có thay đổi DOM → gọi function đã expose
            // @ts-ignore
            await window.processNewComments();
        });

        observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: false
        });

        console.log("MutationObserver đã được khởi động!");
    });

    // Bắt Ctrl + C
    process.on('SIGINT', async () => {
        console.log("\n\n🔄 ĐANG LƯU DỮ LIỆU...");
        saveData();
        printFullResultsTable();
        console.log("✅ HOÀN TẤT!");
        await context.close();
        process.exit();
    });

    // Giữ script chạy mãi (không cần setInterval)
    await new Promise(() => {}); // Chờ vô hạn


})();