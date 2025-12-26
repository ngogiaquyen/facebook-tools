const puppeteer = require('puppeteer');
const moment = require('moment');
const { createObjectCsvWriter } = require('csv-writer');
const ExcelJS = require('exceljs');
const Table = require('cli-table3');
const readlineSync = require('readline-sync');

const VIDEO_URL = "https://www.facebook.com/100062942246111/videos/2025748547994943";

(async () => {
  console.clear();
  console.log("🚀 FB LIVE COMMENT TOOL - Tự code by Grok");
  console.log("==================================================");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--disable-notifications"],
  });

  const page = await browser.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "networkidle2" });

  console.log("\nVui lòng đăng nhập thủ công Facebook trong browser.");
  console.log("Sau khi login xong, quay lại terminal này và nhấn Enter...");
  readlineSync.question("");

  console.log("\nĐang mở live/video...");
  await page.goto(VIDEO_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 12000)); // Đợi lâu hơn

  const commentsData = [];
  let seen = new Set();
  let lastCount = 0;

  const table = new Table({
    head: ['Thời gian', 'Tên', 'UID', 'Comment'],
    colWidths: [13, 25, 20, 50]
  });

  console.log("\n=== BẮT ĐẦU QUÉT COMMENT REALTIME ===");
  console.log("Comment mới sẽ hiện trong bảng bên dưới.");
  console.log("Nhấn Ctrl + C để dừng và xuất file CSV/Excel.\n");

  const scan = async () => {
    try {
      const comments = await page.evaluate(() => {
        const items = document.querySelectorAll('div[role="article"][aria-label^="Comment by"]');
        return Array.from(items).map(item => {
          // LẤY UID CHÍNH XÁC HƠN - từ link avatar hoặc tên
          let uid = "Unknown";
          const avatarLink = item.querySelector('a[role="link"] img')?.closest('a');
          if (avatarLink && avatarLink.href) {
            const match = avatarLink.href.match(/facebook\.com\/(?:profile\.php\?id=)?(\d+)/);
            if (match) uid = match[1];
          }

          // LẤY TÊN NGƯỜI COMMENT CHÍNH XÁC HƠN
          let user = "Unknown";
          const nameSelectors = [
            'strong a span[dir="auto"]',
            'strong span[dir="auto"]',
            'a strong span',
            'h3 strong span',
            'span.x1lliihq strong span',
            'div.x1i10hfl strong span'
          ];
          for (const sel of nameSelectors) {
            const el = item.querySelector(sel);
            if (el && el.innerText.trim()) {
              user = el.innerText.trim();
              break;
            }
          }

          // Nội dung comment
          const textEl = item.querySelector('div[dir="auto"][style*="text-align:start"]') ||
                         item.querySelector('div[dir="auto"] span span') ||
                         item.querySelector('div[dir="auto"] > span');
          const text = textEl ? textEl.innerText.trim() : "";

          return { uid, user, text };
        });
      });

      const newComments = comments.slice(lastCount);
      lastCount = comments.length;

      newComments.forEach(c => {
        const key = c.uid + c.text;
        if (c.text && !seen.has(key)) {
          seen.add(key);
          const time = moment().format("HH:mm:ss");
          const entry = { time, user: c.user, uid: c.uid, comment: c.text };
          commentsData.push(entry);

          table.push([time, c.user, c.uid, c.text]);

          // Highlight chốt đơn
          if (/^\d{2,3}$/.test(c.text.trim()) || /chốt|size|đơn|ib|m|l|xl|64|63|60/i.test(c.text)) {
            console.log(`🚨🚨 CHỐT ĐƠN: "${c.text}" - ${c.user} (UID: ${c.uid})`);
            process.stdout.write('\x07'); // Beep
          }

          // Lọc SĐT
          const phones = c.text.match(/(0[3-9]\d{8})\b/g);
          if (phones) {
            console.log(`📱 SĐT: ${phones.join(', ')} từ ${c.user} (UID: ${c.uid})`);
          }
        }
      });

      if (newComments.length > 0) {
        console.clear();
        console.log(`Đã quét được ${commentsData.length} comment (mới +${newComments.length})`);
        console.log(table.toString());
      }

      // SCROLL MẠNH HƠN ĐỂ LOAD NHIỀU COMMENT
      await page.evaluate(() => {
        // Scroll box comment
        const commentBoxes = document.querySelectorAll('div[style*="overflow-y"]');
        commentBoxes.forEach(box => {
          box.scrollTop = box.scrollHeight + 1000;
        });
        // Scroll page
        window.scrollTo(0, document.body.scrollHeight);
      });

    } catch (e) {
      // console.log("Lỗi:", e.message);
    }

    setTimeout(scan, 2500); // Quét nhanh hơn
  };

  scan();

  process.on("SIGINT", async () => {
    console.log("\n\nĐANG LƯU FILE...");
    const timestamp = moment().format("YYYYMMDD_HHmmss");

    const csvWriter = createObjectCsvWriter({
      path: `comments_${timestamp}.csv`,
      header: [
        {id: 'time', title: 'Thời gian'},
        {id: 'user', title: 'Tên'},
        {id: 'uid', title: 'UID'},
        {id: 'comment', title: 'Comment'}
      ],
      encoding: 'utf8'
    });
    await csvWriter.writeRecords(commentsData);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Comments');
    sheet.addRow(['Thời gian', 'Tên', 'UID', 'Comment']);
    commentsData.forEach(c => sheet.addRow([c.time, c.user, c.uid, c.comment]));
    await workbook.xlsx.writeFile(`comments_${timestamp}.xlsx`);

    console.log(`\nHOÀN TẤT! Đã lưu ${commentsData.length} comment:`);
    console.log(`   → comments_${timestamp}.csv`);
    console.log(`   → comments_${timestamp}.xlsx\n`);

    await browser.close();
    process.exit();
  });

})();