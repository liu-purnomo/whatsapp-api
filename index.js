const express = require('express');
const app = express();
const cors = require('cors');
const {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  default: makeWASocket,
  isJidBroadcast,
  makeInMemoryStore,
} = require('@whiskeysockets/baileys');
const { default: pino, levels } = require('pino');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static('./client/assets'));

app.get('/', (req, res) => {
  res.sendFile('./client/index.html', {
    root: __dirname,
  });
});

let waSocket;
let qr;

const store = makeInMemoryStore({
  logger: pino().child({ level: 'silent', stream: 'store' }),
});

async function connectToWhatsapp() {
  const { state, saveCreds } = await useMultiFileAuthState('stores');
  let { version, isLatest } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    version,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });

  store.bind(waSocket.ev);
}

connectToWhatsapp().catch((err) => console.log(err));

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
