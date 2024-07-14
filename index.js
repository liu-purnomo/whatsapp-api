require('dotenv').config();

const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeInMemoryStore,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const log = require('pino');
const { Boom } = require('@hapi/boom');
const path = require('path');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const server = require('http').createServer(app);
const io = require('socket.io')(server);
const port = process.env.PORT || 8000;

app.use('/assets', express.static(path.join(__dirname, 'client', 'assets')));

const store = makeInMemoryStore({
  logger: log().child({ level: 'silent', stream: 'store' }),
});

let waSocket;
let qrCode;
let ioSocket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');
  const { version } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    auth: state,
    logger: log({ level: 'silent' }),
    version,
    shouldIgnoreJid: isJidBroadcast,
  });

  store.bind(waSocket.ev);

  waSocket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect.error).output.statusCode;
      handleDisconnectReason(reason);
    } else if (connection === 'open') {
      console.log('Connection opened');
      displayGroupInfo();
    }

    if (qr) {
      qrCode = qr;
      updateQRCode('qr');
    } else if (qrCode === undefined) {
      updateQRCode('loading');
    } else if (connection === 'open') {
      updateQRCode('qrscanned');
    }
  });

  waSocket.ev.on('creds.update', saveCreds);
  waSocket.ev.on('messages.upsert', handleMessageUpsert);
}

function handleDisconnectReason(reason) {
  switch (reason) {
    case DisconnectReason.badSession:
      console.log('Bad session file, please delete and scan again');
      waSocket.logout();
      break;
    case DisconnectReason.connectionClosed:
    case DisconnectReason.connectionLost:
    case DisconnectReason.restartRequired:
    case DisconnectReason.timedOut:
      console.log('Connection issue, reconnecting...');
      connectToWhatsApp();
      break;
    case DisconnectReason.connectionReplaced:
    case DisconnectReason.loggedOut:
      console.log('Session replaced or logged out, please scan again');
      waSocket.logout();
      break;
    default:
      waSocket.end(`Unknown disconnect reason: ${reason}`);
  }
}

async function displayGroupInfo() {
  const groups = Object.values(await waSocket.groupFetchAllParticipating());
  groups.forEach((group) => {
    console.log(`Group ID: ${group.id} || Group Name: ${group.subject}`);
  });
}

function handleMessageUpsert({ messages, type }) {
  if (type !== 'notify') return;

  const message = messages[0];
  if (message.key.fromMe) return;

  const textMessage =
    message.message.extendedTextMessage?.text || message.message.conversation;
  const senderId = message.key.remoteJid;

  waSocket.readMessages([message.key]);

  const lowerCaseMessage = textMessage.toLowerCase();
  if (lowerCaseMessage === 'ping') {
    waSocket.sendMessage(senderId, { text: 'Pong' }, { quoted: message });
  } else {
    waSocket.sendMessage(senderId, { text: "I'm online" }, { quoted: message });
  }
}

io.on('connection', (socket) => {
  ioSocket = socket;
  if (isConnected()) {
    updateQRCode('connected');
  } else if (qrCode) {
    updateQRCode('qr');
  }
});

const isConnected = () => !!waSocket?.user;

const updateQRCode = (status) => {
  const statuses = {
    qr: () => {
      qrcode.toDataURL(qrCode, (err, url) => {
        ioSocket?.emit('qr', url);
        ioSocket?.emit('log', 'QR code received, please scan it!');
      });
    },
    connected: () => {
      ioSocket?.emit('qrstatus', './assets/check.svg');
      ioSocket?.emit('log', 'WhatsApp connected!');
    },
    qrscanned: () => {
      ioSocket?.emit('qrstatus', './assets/check.svg');
      ioSocket?.emit('log', 'QR code scanned!');
    },
    loading: () => {
      ioSocket?.emit('qrstatus', './assets/loader.gif');
      ioSocket?.emit('log', 'Registering QR code, please wait!');
    },
  };

  if (statuses[status]) statuses[status]();
};

app.post('/send-message', async (req, res) => {
  try {
    const { message, phone } = req.body;
    const { token } = req.headers;

    if (!message || !phone) {
      return res.status(400).json({
        status: false,
        response: 'Message and phone number are required',
      });
    }

    if (!phone.startsWith('62')) {
      return res.status(400).json({
        status: false,
        response: 'Phone number must start with 62',
      });
    }

    if (!token || token !== process.env.TOKEN_KEY) {
      return res.status(403).json({
        status: false,
        response: 'Unauthorized access, please contact the owner',
      });
    }

    if (isConnected()) {
      const exists = await waSocket.onWhatsApp(`${phone}@s.whatsapp.net`);
      if (exists?.jid || (exists && exists[0]?.jid)) {
        const jid = exists.jid || exists[0].jid;
        waSocket
          .sendMessage(jid, { text: message })
          .then((result) =>
            res.status(200).json({ status: true, response: result })
          )
          .catch((err) =>
            res.status(500).json({ status: false, response: err })
          );
      } else {
        res
          .status(404)
          .json({ status: false, response: `${phone} is not registered.` });
      }
    } else {
      res.status(500).json({
        status: false,
        response: 'WhatsApp is not connected, please connect first.',
      });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

app.get('/', (req, res) => {
  if (isConnected()) {
    res.sendFile(path.join(__dirname, 'client', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'client', 'server.html'));
  }
});

connectToWhatsApp().catch((error) => console.log('Connection error:', error));

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
