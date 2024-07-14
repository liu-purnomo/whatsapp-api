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
const { Boom } = require('@hapi/boom');

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/assets', express.static('./client/assets'));
const server = require('http').createServer(app);
const io = require('socket.io')(server);

app.get('/', (req, res) => {
  res.sendFile('./client/index.html', {
    root: __dirname,
  });
});

let waSocket;
let qr;
let socket;

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
  waSocket.multi = true;

  waSocket.ev.on(
    'connection.update',
    async ({ connection, lastDisconnect, qr }) => {
      if (connection === 'close') {
        let reason = new Boom(lastDisconnect.error).output.statusCode;
        if (reason === DisconnectReason.badSession) {
          console.log(
            `Bad Session File, Please Delete ${session} and Scan Again`
          );
          sock.logout();
        } else if (reason === DisconnectReason.connectionClosed) {
          console.log('Connection closed, reconnecting....');
          connectToWhatsApp();
        } else if (reason === DisconnectReason.connectionLost) {
          console.log('Connection Lost from Server, reconnecting...');
          connectToWhatsApp();
        } else if (reason === DisconnectReason.connectionReplaced) {
          console.log(
            'Connection Replaced, Another New Session Opened, Please Close Current Session First'
          );
          sock.logout();
        } else if (reason === DisconnectReason.loggedOut) {
          console.log(
            `Device Logged Out, Please Delete ${session} and Scan Again.`
          );
          sock.logout();
        } else if (reason === DisconnectReason.restartRequired) {
          console.log('Restart Required, Restarting...');
          connectToWhatsApp();
        } else if (reason === DisconnectReason.timedOut) {
          console.log('Connection TimedOut, Reconnecting...');
          connectToWhatsApp();
        } else {
          sock.end(
            `Unknown DisconnectReason: ${reason}|${lastDisconnect.error}`
          );
        }
      } else if (connection === 'open') {
        console.log('opened connection');
        let groups = Object.values(await sock.groupFetchAllParticipating());

        for (let group of groups) {
          console.log(
            'id_group: ' + group.id + ' || Nama Group: ' + group.subject
          );
        }
        return;
      }

      if (qr) {
        qr = qr;
        updateQR('qr');
      } else if ((qr = undefined)) {
        updateQR('loading');
      } else {
        if (connection === 'open') {
          updateQR('qrscanned');
          return;
        }
      }
    }
  );
}

io.on('connection', async (socket) => {
  soket = socket;
  // console.log(sock)
  if (isConnected) {
    updateQR('connected');
  } else if (qr) {
    updateQR('qr');
  }
});

connectToWhatsapp().catch((err) => console.log(err));

app.listen(3000, () => {
  console.log('Server is running on port 3000');
});
