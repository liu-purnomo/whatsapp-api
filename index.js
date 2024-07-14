const {
  default: makeWASocket,
  DisconnectReason,
  fetchLatestBaileysVersion,
  isJidBroadcast,
  makeInMemoryStore,
  useMultiFileAuthState,
} = require('@whiskeysockets/baileys');

const log = require('pino');
const { session } = { session: 'baileys_auth_info' };
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

app.use('/assets', express.static(__dirname + '/client/assets'));

app.get('/scan', (req, res) => {
  res.sendFile('./client/server.html', {
    root: __dirname,
  });
});

app.get('/', (req, res) => {
  res.sendFile('./client/index.html', {
    root: __dirname,
  });
});

//fungsi suara capital
function capital(textSound) {
  const arr = textSound.split(' ');
  for (var i = 0; i < arr.length; i++) {
    arr[i] = arr[i].charAt(0).toUpperCase() + arr[i].slice(1);
  }
  const str = arr.join(' ');
  return str;
}

const store = makeInMemoryStore({
  logger: log().child({ level: 'silent', stream: 'store' }),
});

let waSocket;
let qr;
let ioSocket;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('stores');
  let { version } = await fetchLatestBaileysVersion();
  waSocket = makeWASocket({
    auth: state,
    logger: log({ level: 'silent' }),
    version,
    shouldIgnoreJid: (jid) => isJidBroadcast(jid),
  });
  store.bind(waSocket.ev);
  waSocket.multi = true;
  waSocket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      let reason = new Boom(lastDisconnect.error).output.statusCode;
      switch (reason) {
        case DisconnectReason.badSession:
          console.log(
            `Bad Session File, Please Delete ${session} and Scan Again`
          );
          waSocket.logout();
          break;
        case DisconnectReason.connectionClosed:
          console.log('Connection closed, reconnecting....');
          connectToWhatsApp();
          break;
        case DisconnectReason.connectionLost:
          console.log('Connection Lost from Server, reconnecting...');
          connectToWhatsApp();
          break;
        case DisconnectReason.connectionReplaced:
          console.log(
            'Connection Replaced, Another New Session Opened, Please Close Current Session First'
          );
          waSocket.logout();
          break;
        case DisconnectReason.loggedOut:
          console.log(
            `Device Logged Out, Please Delete ${session} and Scan Again.`
          );
          waSocket.logout();
          break;
        case DisconnectReason.restartRequired:
          console.log('Restart Required, Restarting...');
          connectToWhatsApp();
          break;
        case DisconnectReason.timedOut:
          console.log('Connection TimedOut, Reconnecting...');
          connectToWhatsApp();
          break;
        default:
          waSocket.end(
            `Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`
          );
      }
    } else if (connection === 'open') {
      console.log('opened connection');
      let groups = Object.values(await waSocket.groupFetchAllParticipating());
      groups.forEach((group) => {
        console.log(
          'id_group: ' + group.id + ' || Nama Group: ' + group.subject
        );
      });
      return;
    }
    if (update.qr) {
      qr = update.qr;
      updateQR('qr');
    } else if (qr === undefined) {
      updateQR('loading');
    } else if (update.connection === 'open') {
      updateQR('qrscanned');
      return;
    }
  });
  waSocket.ev.on('creds.update', saveCreds);
  waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type === 'notify') {
      const message = messages[0];
      if (!message.key.fromMe) {
        const pesan = message.message.conversation;
        const noWa = message.key.remoteJid;

        await waSocket.readMessages([message.key]);

        const pesanMasuk = pesan.toLowerCase();
        if (!message.key.fromMe && pesanMasuk === 'ping') {
          await waSocket.sendMessage(
            noWa,
            { text: 'Pong' },
            { quoted: message }
          );
        } else {
          await waSocket.sendMessage(
            noWa,
            { text: "I'm online" },
            { quoted: message }
          );
        }
      }
    }
  });
}

io.on('connection', async (socket) => {
  ioSocket = socket;
  if (isConnected()) {
    updateQR('connected');
  } else if (qr) {
    updateQR('qr');
  }
});

const isConnected = () => {
  return waSocket?.user;
};

const updateQR = (data) => {
  switch (data) {
    case 'qr':
      qrcode.toDataURL(qr, (err, url) => {
        ioSocket?.emit('qr', url);
        ioSocket?.emit('log', 'QR Code received, please scan!');
      });
      break;
    case 'connected':
      ioSocket?.emit('qrstatus', './assets/check.svg');
      ioSocket?.emit('log', 'WhatsApp terhubung!');
      break;
    case 'qrscanned':
      ioSocket?.emit('qrstatus', './assets/check.svg');
      ioSocket?.emit('log', 'QR Code Telah discan!');
      break;
    case 'loading':
      ioSocket?.emit('qrstatus', './assets/loader.gif');
      ioSocket?.emit('log', 'Registering QR Code, please wait!');
      break;
    default:
      break;
  }
};

app.post('/send-message', async (req, res) => {
  try {
    const { message, phone } = req.body;
    const { token } = req.headers;

    if (!message || !phone) {
      return res.status(500).json({
        status: false,
        response: 'Text message and phone number must be filled',
      });
    }

    if (phone[0] !== '6' && phone[1] !== '2') {
      return res.status(500).json({
        status: false,
        response: 'Phone number must start with 62',
      });
    }

    if (!token) {
      return res.status(500).json({
        status: false,
        response: 'You are not authorized, please contact the owner',
      });
    }

    if (isConnected()) {
      const exists = await waSocket.onWhatsApp(`${phone}@s.whatsapp.net`);
      if (exists?.jid || (exists && exists[0]?.jid)) {
        waSocket
          .sendMessage(exists.jid || exists[0].jid, { text: message })
          .then((result) =>
            res.status(200).json({ status: true, response: result })
          )
          .catch((err) =>
            res.status(500).json({ status: false, response: err })
          );
      } else {
        res.status(500).json({
          status: false,
          response: `${phone} is not registered.`,
        });
      }
    } else {
      res.status(500).json({
        status: false,
        response: `WhatsApp is not connected, please connect first.`,
      });
    }
  } catch (err) {
    res.status(500).send(err);
  }
});

connectToWhatsApp().catch((error) => console.log(error));

server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
