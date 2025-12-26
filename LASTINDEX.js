const { chromium } = require('playwright');
const fs = require('fs');
const XLSX = require('xlsx');

// ================== CẤU HÌNH ==================
const VIDEO_URL = "https://www.facebook.com/jayed973/videos/893195033386431";
const USER_DATA_DIR = "D:/temp/v2/modules"; // Profile đã login

let commentsData = [];
let processedComments = new Set(); // Để tránh lặp comment do script (dựa trên uid + text đầy đủ)

// Lưu file khi dừng
function saveData() {
    if (commentsData.length === 0) {
        console.log("\nChưa thu thập được comment nào.");
        return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 15);
    const csvFile = `fb_comments_${timestamp}.csv`;
    const xlsxFile = `fb_comments_${timestamp}.xlsx`;

    // CSV
    const csvContent = [
        ["Thời gian", "Tên người dùng", "UID", "Nội dung comment"],
        ...commentsData.map(c => [
            c.time,
            c.user,
            c.uid,
            `"${c.comment.replace(/"/g, '""')}"`
        ])
    ].map(row => row.join(",")).join("\n");

    fs.writeFileSync(csvFile, '\uFEFF' + csvContent, 'utf8');
    console.log(`\nĐã lưu CSV: ${csvFile}`);

    // Excel
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
    console.log(`ĐÃ THU THẬP XONG: ${commentsData.length} COMMENT (không lặp do script)`);
    console.log("Dữ liệu đầy đủ đã lưu vào file CSV & Excel.");
    console.log("=".repeat(100));
}

(async () => {
    console.log("FB LIVESTREAM COMMENT COLLECTOR - REALTIME THUẦN TÚY (Sửa lỗi gộp text & lặp comment)");
    console.log("Chỉ chờ comment tự nhảy lên → hiển thị và lưu ngay lập tức!\n");

    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        viewport: { width: 1366, height: 768 },
        args: [
            "--start-maximized",
            "--disable-blink-features=AutomationControlled",
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ]
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(15000); // Chờ livestream/comment load ổn định

    // Hàm xử lý và in comment mới
    await page.exposeFunction('processNewComments', async () => {
        try {
            const commentEls = await page.$$(`
                div[role="article"][aria-label^="Comment"],
                div[role="article"][aria-label^="Bình luận"],
                div.x1n2onr6 div[role="article"],
                div.x1yztbdb div[role="article"],
                div[data-ad-comet-preview="message"]
            `);

            let newCount = 0;

            for (const el of commentEls) {
                try {
                    // Tên người dùng (tối ưu để lấy chính xác, không lẫn với comment)
                    let user = "Unknown";
                    const nameEl = await el.$('a[role="link"] strong > span, a[role="link"] span > strong, h3 > span, span[dir="auto"] > strong > span');
                    if (nameEl) user = (await nameEl.innerText()).trim() || "Unknown";

                    // UID
                    let uid = "Unknown";
                    const linkEl = await el.$('a[role="link"][href*="facebook.com/"]');
                    if (linkEl) {
                        const href = await linkEl.getAttribute('href');
                        const match = href.match(/\/(profile\.php\?id=|user\/|people\/[^\/]+\/)(\d+)/);
                        if (match) uid = match[2];
                    }

                    // Nội dung comment (tối ưu selector để CHỈ lấy phần text comment, loại trừ tên user và các phần khác)
                    let commentText = "";
                    const textEls = await el.$$('div[dir="auto"] > div:not(:has(a[role="link"])):not(:has(strong)):not(:has(span[aria-hidden])), span[dir="auto"]:not(:has(strong))');
                    for (const t of textEls) {
                        const txt = (await t.innerText()).trim();
                        if (txt.length > 1 && txt !== user) { // Loại bỏ nếu trùng tên user
                            commentText += txt + " ";
                        }
                    }
                    commentText = commentText.trim();

                    if (commentText.length < 2) continue;

                    // Key để tránh lặp do script (cho phép trùng nếu user thật sự comment lại)
                    const key = `${uid}-${commentText}`;
                    if (processedComments.has(key)) continue;
                    processedComments.add(key);

                    const timeStr = new Date().toTimeString().slice(0, 8);
                    const entry = { time: timeStr, user, uid, comment: commentText };
                    commentsData.push(entry);

                    // IN RA NGAY LẬP TỨC - ĐẦY ĐỦ
                    console.log(`[${timeStr}] ${user.padEnd(28)} | UID: ${uid.padEnd(16)} | ${commentText}`);

                    newCount++;

                } catch (e) {}
            }

            if (newCount > 0) {
                console.log(`→ Phát hiện ${newCount} comment mới thật sự | Tổng: ${commentsData.length}\n`);
            }

        } catch (err) {
            console.error("Lỗi xử lý comment:", err);
        }
    });

    // MutationObserver với debounce nhẹ (200ms) để tránh gọi quá nhiều lần khi DOM thay đổi nhanh
    await page.evaluate(() => {
        function debounce(func, delay) {
            let timer;
            return () => {
                clearTimeout(timer);
                timer = setTimeout(func, delay);
            };
        }

        const container = document.querySelector('div[role="feed"]') || document.body;

        const debouncedProcess = debounce(() => {
            // @ts-ignore
            window.processNewComments();
        }, 200);

        const observer = new MutationObserver(debouncedProcess);
        observer.observe(container, {
            childList: true,
            subtree: true
        });

        console.log("ĐÃ KÍCH HOẠT THEO DÕI REALTIME VỚI CHỐNG LẶP!");
        console.log("Comment mới sẽ hiển thị ngay, không gộp tên và không lặp vô lý...\n");
    });

    // Ctrl + C để dừng và lưu
    process.on('SIGINT', async () => {
        console.log("\n\nĐang dừng và lưu dữ liệu...");
        printSummary();
        saveData();
        console.log("\nHoàn tất! Đóng trình duyệt...");
        await context.close();
        process.exit(0);
    });

    // Giữ script chạy mãi
    await new Promise(() => {});
})();