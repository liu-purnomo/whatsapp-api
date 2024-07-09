const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.sendFile('./client/index.html', {
    root: __dirname,
  });
});

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
