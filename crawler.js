const puppeteer = require("puppeteer");
const { createObjectCsvWriter } = require("csv-writer");
const moment = require("moment");

const VIDEO_URL = "https://www.facebook.com/100062942246111/videos/2025748547994943";

(async () => {
  console.log("🚀 Đang khởi động browser...");

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ["--start-maximized", "--disable-notifications"],
  });

  const page = await browser.newPage();
  await page.goto("https://www.facebook.com/", { waitUntil: "networkidle2" });

  console.log("\n=== HƯỚNG DẪN ===");
  console.log("Vui lòng đăng nhập thủ công Facebook trong cửa sổ browser.");
  console.log("Sau khi đăng nhập xong, quay lại terminal và nhấn Enter...");
  await new Promise((resolve) => process.stdin.once("data", resolve));

  console.log("\nĐang mở live video...");
  await page.goto(VIDEO_URL, { waitUntil: "networkidle2" });

  // Đợi load và scroll mạnh xuống phần comment ngay từ đầu
  await new Promise((resolve) => setTimeout(resolve, 10000));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise((resolve) => setTimeout(resolve, 5000));

  const commentsData = []; // Lưu tất cả để xuất CSV khi dừng
  let previousCommentCount = 0; // Theo dõi số comment lần trước để phát hiện mới

  console.log("\n" + "=".repeat(80));
  console.log("       📢 BẮT ĐẦU LOG REALTIME NỘI DUNG BÌNH LUẬN TRONG LIVE");
  console.log("       Mọi bình luận mới sẽ được log ngay bên dưới đây!");
  console.log("       Nhấn Ctrl + C để dừng và lưu file CSV");
  console.log("=".repeat(80) + "\n");

  const logComments = async () => {
    try {
      const commentBlocks = await page.$$('div[role="article"][aria-label^="Comment by"]');
      console.log(`🔍 ${moment().format("HH:mm:ss")} - Đang thấy ${commentBlocks.length} bình luận`);

      if (commentBlocks.length === 0) {
        console.log("   ⚠️ Chưa load comment → Scroll mạnh để kích hoạt...");
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        return;
      }

      const currentComments = await page.$$eval(
        'div[role="article"][aria-label^="Comment by"]',
        (elements) => {
          return elements.map((el) => {
            // Lấy tên user
            let user = "Unknown";
            const userSelectors = [
              'a[role="link"] strong span span[dir="auto"]',
              'strong a span[dir="auto"]',
              'a strong span span',
              'h3 strong span',
              'strong span[dir="auto"]',
              'span.x193iq5w span[dir="auto"]',
              'span[dir="auto"] > strong > span',
            ];
            for (const sel of userSelectors) {
              const u = el.querySelector(sel);
              if (u && u.innerText.trim()) {
                user = u.innerText.trim();
                break;
              }
            }

            // Lấy nội dung bình luận
            let textEl =
              el.querySelector('div[dir="auto"][style*="text-align:start"]') ||
              el.querySelector('div[dir="auto"] span span') ||
              el.querySelector('div[dir="auto"] > span') ||
              el.querySelector('span[dir="auto"]');

            const text = textEl ? textEl.innerText.trim() : "";

            return { user, text };
          });
        }
      );

      // Chỉ log những bình luận MỚI (từ lần quét trước đến giờ)
      const newComments = currentComments.slice(previousCommentCount);
      previousCommentCount = currentComments.length;

      if (newComments.length > 0) {
        console.log(`\n       🎉 Có ${newComments.length} bình luận mới!\n`);

        newComments.forEach((c) => {
          const time = moment().format("HH:mm:ss");
          commentsData.push({ time, user: c.user, comment: c.text });

          // LOG REALTIME CHÍNH
          console.log(`[${time}] 👤 ${c.user.padEnd(20)} | ${c.text}`);

          // Highlight nếu nghi chốt đơn (để bạn dễ thấy)
          if (/^\d{2,3}$/.test(c.text.trim()) || /chốt|size|đơn|ib|m|l|xl/i.test(c.text)) {
            console.log(`           🚨 CHỐT ĐƠN NGHI NGỜ: "${c.text.trim()}" từ ${c.user}`);
            process.stdout.write('\x07'); // Tiếng ting ting báo
          }
        });
        console.log(""); // Dòng trống cho dễ nhìn
      }

    } catch (err) {
      console.log("Lỗi quét:", err.message);
    }
  };

  // Quét mỗi 2 giây
  setInterval(logComments, 2000);

  // Scroll đều để load comment mới (live push từ dưới)
  setInterval(async () => {
    await page.evaluate(() => window.scrollBy(0, 800));
  }, 2500);

  // Dừng bằng Ctrl+C
  process.on("SIGINT", async () => {
    console.log("\n" + "=".repeat(80));
    console.log("       ⏹️ DỪNG LOG - ĐANG LƯU FILE CSV");
    console.log("=".repeat(80));

    const filename = `comments_live_${moment().format("YYYYMMDD_HHmmss")}.csv`;
    const csvWriter = createObjectCsvWriter({
      path: filename,
      header: [
        { id: "time", title: "Thời gian" },
        { id: "user", title: "Người comment" },
        { id: "comment", title: "Nội dung bình luận" },
      ],
      encoding: "utf8",
    });

    await csvWriter.writeRecords(commentsData);
    console.log(`\n✅ Đã lưu ${commentsData.length} bình luận vào file: ${filename}`);
    console.log("\nChúc live đông khách và chốt nhiều đơn! 💰🔥");

    await browser.close();
    process.exit();
  });
})();