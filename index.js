const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const XLSX = require('xlsx'); // npm install xlsx

// ================== CẤU HÌNH ==================
const VIDEO_URL = "https://www.facebook.com/jayed973/videos/893195033386431";
const USER_DATA_DIR = "E:/TOOL/FACEBOOK/nodejs/fb_profile_tool"; // Thay bằng đường dẫn của bạn
const CHOT_DON_REGEX = /\b(\d{2,3})\b|chốt|chot|size|đơn|ib|inbox|m|l|xl|xxl|64|63|60|số|so/i;

let commentsData = [];

// Beep âm thanh (Windows)
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

// In bảng comment mới realtime
function printNewCommentsTable(newEntries) {
    if (newEntries.length === 0) return;

    console.log("\n" + "=".repeat(120));
    console.log("🆕 COMMENT MỚI (REALTIME - KHÔNG LỌC TRÙNG)");
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
    console.log(`📊 Tổng cộng đã thu thập: ${commentsData.length} comment (bao gồm lặp lại)\n`);
}

// In toàn bộ bảng khi dừng
function printFullResultsTable() {
    if (commentsData.length === 0) {
        console.log("\nChưa có comment nào được thu thập.");
        return;
    }

    console.log("\n" + "=".repeat(120));
    console.log("📋 TỔNG HỢP TOÀN BỘ COMMENT (KHÔNG LỌC TRÙNG)");
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

// Lưu file CSV + Excel
function saveData() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);
    const csvFile = `ninja_comments_${timestamp}.csv`;

    // CSV
    const csvContent = [
        ["time", "user", "uid", "comment"],
        ...commentsData.map(c => [c.time, c.user, c.uid, c.comment])
    ].map(e => e.join(",")).join("\n");

    fs.writeFileSync(csvFile, '\uFEFF' + csvContent, 'utf8'); // BOM cho Excel mở tiếng Việt đúng
    console.log(`   → ${csvFile} (CSV)`);

    // Excel
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
    console.log("🚀 NINJA COMMENT CLONE – Node.js + Playwright (Realtime Max, Không Lọc Trùng)");

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

    console.log("\n🌐 Browser đã mở với profile riêng!");
    console.log("👉 Lần đầu: Đăng nhập www.facebook.com thủ công");
    console.log("👉 Lần sau: Tự động login!\n");

    // Tự động mở video (bạn có thể comment input() nếu muốn chờ)
    console.log(`\nĐang mở video: ${VIDEO_URL}`);
    await page.goto(VIDEO_URL, { timeout: 60000, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000); // Đợi load comment

    console.log("\n=== BẮT ĐẦU QUÉT COMMENT REALTIME (SIÊU NHANH) ===");
    console.log("⚠️  MỌI COMMENT ĐỀU ĐƯỢC LƯU – KỂ CẢ LẶP LẠI!");
    console.log("Ctrl + C để dừng và lưu file.\n");

    let lastCount = 0;

    // MutationObserver để phát hiện comment mới gần như tức thì
    await page.evaluate(() => {
        window.newCommentsFlag = false;
        const observer = new MutationObserver(() => {
            window.newCommentsFlag = true;
        });
        const container = document.querySelector('div[role="feed"]') || document.body;
        observer.observe(container, { childList: true, subtree: true });
    });

    const checkInterval = setInterval(async () => {
        try {
            // Kiểm tra flag từ MutationObserver
            const hasNew = await page.evaluate(() => window.newCommentsFlag);
            if (hasNew) {
                await page.evaluate(() => window.newCommentsFlag = false);
            }

            // Scroll nhẹ để load thêm (nếu cần)
            await page.evaluate(() => {
                const containers = document.querySelectorAll('div[role="feed"], div[style*="overflow"], article');
                containers.forEach(el => {
                    if (el.scrollTop !== undefined) el.scrollTop = el.scrollHeight + 1000;
                });
                window.scrollBy(0, 600);
            });

            const comments = await page.$$(
                'div[role="article"][aria-label^="Comment by"], div[role="article"][aria-label*="Comment by"]'
            );

            const newComments = comments.slice(lastCount);
            lastCount = comments.length;

            const newEntries = [];

            for (const el of newComments) {
                try {
                    const nameEl = await el.$('a[role="link"] span.x193iq5w, a[role="link"] strong span, a[role="link"] span[dir="auto"]');
                    const name = nameEl ? (await nameEl.innerText()).trim() : "Unknown";

                    let uid = "Unknown";
                    const avatarLink = await el.$('a[role="link"][href*="facebook.com/"]');
                    if (avatarLink) {
                        const href = await avatarLink.getAttribute('href');
                        const match = href.match(/\/(\d{10,})[/?&]|profile\.php\?id=(\d+)/);
                        if (match) uid = match[1] || match[2];
                    }

                    let text = "";
                    const textEl = await el.$(
                        'div[dir="auto"][style*="text-align"] > div[dir="auto"], ' +
                        'div.xdj266r div[dir="auto"]:not(:has(a)), ' +
                        'span[dir="auto"] + div[dir="auto"] > div[dir="auto"]'
                    );
                    if (textEl) text = (await textEl.innerText()).trim();

                    if (!text) {
                        const backup = await el.$('div[dir="auto"] > div[dir="auto"]');
                        if (backup) text = (await backup.innerText()).trim();
                    }

                    if (text) {
                        const timeStr = new Date().toTimeString().slice(0, 8);
                        const entry = { time: timeStr, user: name, uid, comment: text };
                        commentsData.push(entry);
                        newEntries.push(entry);

                        console.log(`[${timeStr}] ${name} (UID: ${uid})`);
                        console.log(`    → ${text}`);
                        highlight(text, name, uid);
                        console.log("-".repeat(100));
                    }
                } catch (err) {
                    // Bỏ qua lỗi nhỏ
                }
            }

            if (newEntries.length > 0) {
                printNewCommentsTable(newEntries);
            }

        } catch (err) {
            console.error("Lỗi trong vòng lặp:", err.message);
        }
    }, 2000); // Check mỗi 2 giây – rất nhanh và ổn định

    // Bắt Ctrl + C
    process.on('SIGINT', async () => {
        clearInterval(checkInterval);
        console.log("\n\n🔄 ĐANG LƯU DỮ LIỆU...");
        saveData();
        printFullResultsTable();
        console.log("✅ HOÀN TẤT! Đã lưu file và in bảng tổng hợp.");
        await context.close();
        process.exit();
    });

})();