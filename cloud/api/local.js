require('dotenv').config();
const app = require('./index');

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`HBL360 cloud API listening on http://localhost:${port}`);
});
