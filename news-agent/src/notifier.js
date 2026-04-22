// Console notification instead of email/Slack
function sendNotification(item, score) {
  console.log(`\n=== NEWS ALERT ===`);
  console.log(`Title: ${item.title}`);
  console.log(`Summary: ${item.summary}`);
  console.log(`Impact Score: ${score}`);
  console.log(`Link: ${item.link}`);
  console.log(`Reply YES to research, NO to skip.`);
  console.log(`==================\n`);
}

module.exports = { sendNotification };