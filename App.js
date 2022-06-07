import React from 'react';
import {
  SafeAreaView,
  StyleSheet,
  ScrollView,
  View,
  Text,
  StatusBar,
  NativeModules,
  NativeEventEmitter,
  Button,
  // Platform,
  // PermissionsAndroid,
  FlatList,
  TouchableHighlight,
  Switch,
} from 'react-native';

import { Colors } from 'react-native/Libraries/NewAppScreen';

import BleManager, { write } from 'react-native-ble-manager';
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

// nb: react-native-crypto has a dependency issue;
// library used seems less good but ok for our purposes
// https://github.com/juhoen/hybrid-crypto-js
import { Crypt, RSA } from 'hybrid-crypto-js';
import 'react-native-get-random-values';

import EncryptedStorage from 'react-native-encrypted-storage';
import { stringToBytes, bytesToString } from 'convert-string';

const KEYSHARE_HEADER = 'DENSE keyshare';
const EXPOSURE_HEADER = 'DENSE exposure';
const SERVICE_UUID = '10000000-0000-0000-0000-000000000001';
const CHAR_UUID = '20000000-0000-0000-0000-000000000001';
const CHAR_UUID2 = '20000000-0000-0000-0000-000000000002';
const CHAR_UUID3 = '20000000-0000-0000-0000-000000000003';
const CHAR_UUID4 = '20000000-0000-0000-0000-000000000004';

const App = () => {
  const [isScanning, setIsScanning] = React.useState(false);
  const [peripherals, setPeripherals] = React.useState(new Map());

  let contactKeyToTime = new Map();
  let notifications = new Set();
  let trip = false;

  const [list, setList] = React.useState([]);
  const [setRead, setReadInstead] = React.useState(false);
  // let publicKey, privateKey;
  const [publicKey, setPublicKey] = React.useState(undefined);
  const [privateKey, setPrivateKey] = React.useState(undefined);
  const crypt = new Crypt({ md: 'sha256' });
  let parts = [];
  const readListener = () => {
    setInterval(() => {
      console.log('Checking for key exchange messages...');
      peripherals.forEach((peripheral) => {
        let message = readMessage(peripheral, CHAR_UUID);
        let message2, message3, message4;
        setTimeout(() => {
          message2 = readMessage(peripheral, CHAR_UUID2);
        }, 1500);
        setTimeout(() => {
          message3 = readMessage(peripheral, CHAR_UUID3);
        }, 3500);
        setTimeout(() => {
          message4 = readMessage(peripheral, CHAR_UUID4);
        }, 5500);
        if (message) console.log('1', message);
        if (message2) console.log('2', message2);
        if (message3) console.log('3', message3);
        if (message4) console.log('4', message4);
        if (message && message !== 'EOF') {
          if (message.startsWith(KEYSHARE_HEADER)) {
            const msg = JSON.parse(msg);
            if (msg.pk === publicKey) {
              return;
            }
            // if (message.header === KEYSHARE_HEADER) {
            processKeyShareMessage(msg);
            // return;
            // return;
            // }
          }
        }
        if (message2 && message2 !== 'EOF') {
          parts[0] = JSON.parse(JSON.stringify(msg))['header-1'];
          console.log('potnetial rem', msg);
        }
        if (message3 && message3 !== 'EOF') {
          parts[1] = JSON.parse(JSON.stringify(msg))['header-2'];
        }
        if (message4 && message4 !== 'EOF') {
          parts[2] = JSON.parse(JSON.stringify(msg))['header-3'];
        }

        if (parts[0] && parts[1] && parts[2] && !trip) {
          trip = true;
          processExposureMessage(parts.join(''));
        }
      });
    }, 5000);
  };
  React.useEffect(() => {
    retrieveUserSession();
    // Initialize public and private keys
    if (publicKey === undefined) {
      var rsa = new RSA({ entropy: 244 });
      rsa.generateKeyPair(function (keys) {
        console.log(keys);
        // publicKey = keys.publicKey;
        // privateKey = keys.privateKey;
        setPrivateKey(keys.privateKey);
        setPublicKey(keys.publicKey);
      }, 1024);
    }

    BleManager.start({ showAlert: false });

    bleManagerEmitter.addListener('BleManagerDiscoverPeripheral', handleDiscoverPeripheral);
    bleManagerEmitter.addListener('BleManagerStopScan', handleStopScan);
    bleManagerEmitter.addListener('BleManagerDisconnectPeripheral', handleDisconnectedPeripheral);
    readListener();
    // retrieveUserSession();
  }, []);

  const retrieveUserSession = async () => {
    console.log('Retrieving user session.');
    try {
      const session = await EncryptedStorage.getItem('session');
      if (session !== undefined) {
        console.log('Session found - setup from encrypted storage.');
        sessionObj = JSON.parse(session);
        // publicKey = sessionObj['pk'];
        // privateKey = sessionObj['sk'];
        setPrivateKey(sessionObj['sk']);
        setPublicKey(sessionObj['pk']);
        contactKeyToTime = new Map(Object.entries(JSON.parse(sessionObj['contactKeyToTime'])));
        notifications = new Set(sessionObj['notifications']);
        console.log('Setup complete.');
      }
    } catch (error) {
      console.log('Encountered error in retrieving user session.');
    }
  };

  const storeUserSession = async () => {
    const sessionObj = new Object();
    sessionObj['notifications'] = Array.from(notifications.values());
    sessionObj['contactKeyToTime'] = JSON.stringify(contactKeyToTime);
    sessionObj['pk'] = publicKey;
    sessionObj['sk'] = privateKey;
    await EncryptedStorage.setItem('session', JSON.stringify(sessionObj));
  };

  const startScan = () => {
    if (!isScanning) {
      // scan for 2 seconds
      BleManager.scan([SERVICE_UUID], 5, true)
        .then((results) => {
          console.log('Scanning...');
          setIsScanning(true);
        })
        .catch((err) => {
          console.error(err);
        });
    }
  };
  const stopScan = () => {
    BleManager.stopScan();
  };

  const handleStopScan = () => {
    console.log('Scan is stopped');
    setIsScanning(false);
  };

  const handleDisconnectedPeripheral = (data) => {
    let peripheral = peripherals.get(data.peripheral);
    if (peripheral) {
      peripheral.connected = false;
      peripherals.set(peripheral.id, peripheral);
      setList(Array.from(peripherals.values()));
    }
    console.log('Disconnected from ' + data.peripheral);
  };

  const retrieveConnected = () => {
    BleManager.getConnectedPeripherals([]).then((results) => {
      if (results.length == 0) {
        console.log('No connected peripherals');
      }
      console.log(results);
      for (var i = 0; i < results.length; i++) {
        var peripheral = results[i];
        peripheral.connected = true;
        peripherals.set(peripheral.id, peripheral);
        setList(Array.from(peripherals.values()));
      }
    });
  };

  const handleDiscoverPeripheral = (peripheral) => {
    if (!peripheral.name) {
      peripheral.name = 'NO NAME';
    } else {
      peripherals.set(peripheral.id, peripheral);
      console.log('added discovered peripheral: ' + peripheral.id);
      setList(Array.from(peripherals.values()));
    }
  };

  const writeMessage = (peripheral, message = 'hello world', CHARID = CHAR_UUID) => {
    if (peripheral) {
      // if (!peripheral.connected) {
      //   console.log('connecting to ' + JSON.stringify(peripheral));
      //   BleManager.connect(peripheral.id)
      //     .then(() => {
      //       let p = peripherals.get(peripheral.id);
      //       if (p) {
      //         p.connected = true;
      //         peripherals.set(peripheral.id, p);
      //         setList(Array.from(peripherals.values()));
      //       }
      //       console.log('Connected to ' + peripheral.id);
      //     })
      //     .catch((error) => {
      //       console.log('Connection error', error);
      //     });
      // }

      const handleUpdateValueForCharacteristic = ({
        value,
        peripheral,
        characteristic,
        service,
      }) => {
        BleManager.getConnectedPeripherals([]).then((results) => {
          console.log(results);
        });
        console.log(
          'Received data from ' + peripheral + ' characteristic ' + characteristic,
          bytesToString(value)
        );
      };

      /* Test read current RSSI value */
      BleManager.retrieveServices(peripheral.id).then(async (peripheralData) => {
        console.log('Retrieved peripheral services', peripheralData);
        try {
          await BleManager.startNotification(peripheral.id, SERVICE_UUID, CHARID);
          bleManagerEmitter.addListener(
            'BleManagerDidUpdateValueForCharacteristic',
            handleUpdateValueForCharacteristic
          );
          BleManager.writeWithoutResponse(
            peripheral.id,
            SERVICE_UUID,
            CHARID,
            stringToBytes(message)
          )
            .then(async () => {
              console.log('Write done');
              // await BleManager.stopNotification(peripheral.id, SERVICE_UUID, CHARID);
            })
            .catch((err) => {
              console.log(err);
            });
        } catch (err) {
          console.error(err);
        }

        BleManager.readRSSI(peripheral.id).then((rssi) => {
          console.log('Retrieved actual RSSI value', rssi);
          let p = peripherals.get(peripheral.id);
          if (p) {
            p.rssi = rssi;
            peripherals.set(peripheral.id, p);
            setList(Array.from(peripherals.values()));
          }
        });
      });
    }
  };

  const readMessage = (peripheral, CHARID = CHAR_UUID) => {
    BleManager.connect(peripheral.id).then(() => {
      BleManager.retrieveServices(peripheral.id).then(async () => {
        try {
          await BleManager.startNotification(peripheral.id, SERVICE_UUID, CHARID);
          bleManagerEmitter.addListener('BleManagerDidUpdateValueForCharacteristic', () => {});
          const data = await BleManager.read(peripheral.id, SERVICE_UUID, CHARID);
          console.log('Read: ' + bytesToString(data));
          return data;
        } catch (err) {
          console.log(err);
        }
      });
    });
  };

  const genKeyPair = () => {
    rsa = new RSA({ entropy: crypto.getRandomValues(new Int32Array([244, 100])) });
    rsa.generateKeyPair(function (keys) {
      console.log(keys);
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    }, 1024);
  };

  const testCrypto = () => {
    var toEncrypt = crypto.getRandomValues(new Int32Array([244, 100]));
    var encrypted = crypt.encrypt(publicKey, toEncrypt);
    var decrypted = crypt.decrypt(privateKey, encrypted);
    console.log('Encrypted', toEncrypt, ' and got back', decrypted);
  };

  const testKeyShare = () => {
    contactKeyToTime = new Map();
    notifications = new Set();
    let msg = genKeyShareMessage();
    console.log(msg);
    let serialized = JSON.stringify(msg);
    processKeyShareMessage(serialized);
  };

  /**
   * Test generation and processing of local exposure notification.
   */
  const testExposureNotification = () => {
    contactKeyToTime = new Map();
    notifications = new Set();
    const time = new Date().toUTCString();
    contactKeyToTime.set(publicKey, time);
    let msg = genExposureNotification();
    sanityCheck(msg.message);
    let serialized = JSON.stringify(msg);
    processExposureMessage(serialized);
  };

  /* Generate a trivial key advertisement message.
   */
  const genKeyShareMessage = () => {
    const time = new Date();
    const msg = {
      header: KEYSHARE_HEADER,
      pk: publicKey,
      time: time.toUTCString(),
    };
    console.log('Generated key advertisement message', msg);
    return msg;
  };

  const sanityCheck = (encrypted) => {
    console.log('Performing sanity check...');
    const decrypted = crypt.decrypt(privateKey, encrypted);
    console.log('Successfully decrypted message.');
    const verified = crypt.verify(publicKey, decrypted.signature, decrypted.message);
    if (verified) {
      console.log('Encryption and signature passes sanity check!');
      console.log('Decrypted message: ', decrypted.message);
    }
  };

  /* Generate an exposure notification message. Messages include a header,
   * time (if >a week ago, stop forwarding), and signed, encrypted
   * [sender's public key, time that message was sent]. (The time can't be verified/signed
   * as the message may be forwarded by intermediaries who shouldn't know the sender's identity.)
   */
  const genExposureNotification = () => {
    console.log('Generating exposure notification...');
    // Encrypted information
    const time = new Date();
    const salt = crypto.getRandomValues(new Int32Array([244]))[0];
    const message = {
      sender_pk: publicKey,
      time: time.toUTCString(),
      salt: salt,
    };
    const signature = crypt.signature(privateKey, JSON.stringify(message));

    const encrypted = crypt.encrypt(
      Array.from(contactKeyToTime.keys()),
      JSON.stringify(message),
      signature
    );

    console.log('Successfully encrypted message.');

    const msg = { header: EXPOSURE_HEADER, time: time, message: encrypted };
    return msg;
  };

  /* Processes a key-share message. The message should be of the following format:
   * - header: should be equal to KEYSHARE_HEADER
   * - message: should contain a public key
   */
  const processKeyShareMessage = (message) => {
    const time = message.time;
    const pk = message.pk;

    console.log(`Received keyshare message at time ${time}.`);
    // Log message info
    contactKeyToTime.set(pk, message.time);
    storeUserSession();
  };

  /* Processes an exposure notification message. The message should be of the following format:
   * - header: should be equal to EXPOSURE_HEADER
   * - time: time when message was sent
   * - message: JSON object { pk, time, salt } encrypted with the recipient's public key
   */
  const processExposureMessage = (msg) => {
    const message = JSON.parse(msg);
    // Ignore notifications more than a week old
    if (Date.now() - Date.parse(message.time) >= 7 * 24 * 60 * 60 * 1000) {
      console.log(`ignoring stale exposure message`);
      return;
    }

    // Check if message has already been received
    if (notifications.has(message)) {
      console.log('Message already contained in notifications.');
      return;
    }

    // Add to encrypted notification storage
    notifications.add(msg);
    console.log('Adding exposure notification to storage.');
    storeUserSession();
    console.log('Updated storage.');

    let decrypted = null;
    try {
      decrypted = crypt.decrypt(privateKey, message.message);
    } catch (error) {
      return;
    }
    console.log('Successfully decrypted exposure notification.');

    let sender_pk = JSON.parse(decrypted.message).sender_pk;
    const verified = crypt.verify(sender_pk, decrypted.signature, decrypted.message);
    if (!verified) {
      console.log('Received exposure notification with incorrect signature.');
      return;
    }
    // don't accept your own
    if (sender_pk === publicKey) {
      return;
    }
    // Check if key belongs to close contact
    if (contactKeyToTime.has(sender_pk)) {
      console.log(`Exposure at time ${contactKeyToTime.get(sender_pk)}.`);
      // Send notification to user
    }
    console.log('Completed processing of exposure message...');
    alert('Exposure detected! Please contact your local health care provider.');
  };

  const initExchange = () => {
    try {
      console.log('Initializing exchange...');
      const keyExchangeMessage = genKeyShareMessage();
      const keyExchangeMessageSerialized = JSON.stringify(keyExchangeMessage);
      console.log('Sending key exchange message...');
      console.log(peripherals);
      peripherals.forEach((peripheral) => {
        writeMessage(peripheral, keyExchangeMessageSerialized, CHAR_UUID);
      });
    } catch (error) {
      console.log('Error initializing exchange.\n', err);
    }
  };

  const initExposureNotification = () => {
    console.log('logging your exposure');
    const exposureMessage = genExposureNotification();
    const exposureMessageSerialized = JSON.stringify(exposureMessage);
    console.log('Sending exposure notification...\n', exposureMessageSerialized);
    peripherals.forEach((peripheral) => {
      const chunk1 = exposureMessageSerialized.slice(0, 400);
      const chunk2 = exposureMessageSerialized.slice(400, 800);
      const chunk3 = exposureMessageSerialized.slice(800, exposureMessageSerialized.length);
      setTimeout(() => {
        writeMessage(peripheral, JSON.stringify({ 'header-1': chunk1 }), CHAR_UUID2);
        setTimeout(() => {
          writeMessage(peripheral, JSON.stringify({ 'header-1': chunk1 }), CHAR_UUID2);
          setTimeout(() => {
            writeMessage(peripheral, JSON.stringify({ 'header-2': chunk2 }), CHAR_UUID3);
            setTimeout(() => {
              writeMessage(peripheral, JSON.stringify({ 'header-2': chunk2 }), CHAR_UUID3);
              setTimeout(() => {
                writeMessage(peripheral, JSON.stringify({ 'header-3': chunk3 }), CHAR_UUID4);
                setTimeout(() => {
                  writeMessage(peripheral, JSON.stringify({ 'header-3': chunk3 }), CHAR_UUID4);
                }, 4500);
              }, 3500);
            }, 2500);
          }, 1500);
        }, 1000);
      }, 10);

      // writeMessage(peripheral, exposureMessageSerialized.slice(0, 512));
      // writeMessage(
      //   peripheral,
      //   exposureMessageSerialized.slice(512, exposureMessageSerialized.length)
      // );
      // writeMessage(peripheral, exposureMessageSerialized);
    });
  };

  const renderItem = (item) => {
    const color = item.connected ? 'green' : '#fff';
    return (
      // <TouchableHighlight onPress={() => (setRead ? readMessage(item) : writeMessage(item))}>
      <TouchableHighlight
        onPress={() => {
          BleManager.connect(item.id)
            .then(() => {
              // let p = peripherals.get(item.id);
              // if (p) {
              // p.connected = true;
              let tmp = peripherals;
              tmp.set(item.id, item);
              setPeripherals(tmp);
              setList(Array.from(peripherals.values()));
              // }
              console.log('Connected to ' + item.id);
            })
            .catch((error) => {
              console.log('Connection error', error);
            });

          // BleManager.connect(item.id).then((peripheralInfo) => {
          //   console.log('Connected to', item);
          //   peripherals.set(item.id, item);
          // });
        }}>
        <View style={[styles.row, { backgroundColor: color }]}>
          <Text
            style={{
              fontSize: 12,
              textAlign: 'center',
              color: '#333333',
              padding: 10,
            }}>
            {item.name}
          </Text>
          <Text
            style={{
              fontSize: 10,
              textAlign: 'center',
              color: '#333333',
              padding: 2,
            }}>
            RSSI: {item.rssi}
          </Text>
          <Text
            style={{
              fontSize: 8,
              textAlign: 'center',
              color: '#333333',
              padding: 2,
              paddingBottom: 20,
            }}>
            {item.id}
          </Text>
        </View>
      </TouchableHighlight>
    );
  };

  return (
    <>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView>
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={styles.scrollView}>
          {global.HermesInternal == null ? null : (
            <View style={styles.engine}>
              <Text style={styles.footer}>Engine: Hermes</Text>
            </View>
          )}
          <View style={styles.body}>
            <View style={{ margin: 10 }}>
              <Button
                title={'Scan Bluetooth (' + (isScanning ? 'on' : 'off') + ')'}
                onPress={() => (!isScanning ? startScan() : stopScan())}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button title="Retrieve connected peripherals" onPress={() => retrieveConnected()} />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Generate a fresh key pair (may take a while)"
                onPress={() => genKeyPair()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button title="Encrypt and decrypt a message" onPress={() => testCrypto()} />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Generate and process keyshare message"
                onPress={() => testKeyShare()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Generate and process exposure notification"
                onPress={() => testExposureNotification()}
              />
            </View>
            <View
              style={{
                margin: 10,
                justifyContent: 'center',
                alignItems: 'center',
                width: '100%',
                flexDirection: 'row',
              }}>
              <Button title="initate exchange" onPress={initExchange} />
              <Button color={'red'} title="🚨 GOT DA VID" onPress={initExposureNotification} />
            </View>
            <View
              style={{
                flexDirection: 'row',
                width: '100%',
                justifyContent: 'center',
                alignItems: 'center',
              }}>
              <Switch onValueChange={() => setReadInstead(!setRead)} value={setRead} />
              <Text style={{ paddingLeft: 12, fontWeight: 'bold' }}>Read mode</Text>
            </View>

            {list.length == 0 && (
              <View style={{ flex: 1, margin: 20 }}>
                <Text style={{ textAlign: 'center' }}>No peripherals</Text>
              </View>
            )}
          </View>
          <FlatList
            data={list}
            renderItem={({ item }) => renderItem(item)}
            keyExtractor={(item) => item.id}
          />
        </ScrollView>
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    backgroundColor: Colors.lighter,
  },
  engine: {
    position: 'absolute',
    right: 0,
  },
  body: {
    backgroundColor: Colors.white,
  },
  sectionContainer: {
    marginTop: 32,
    paddingHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '600',
    color: Colors.black,
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: '400',
    color: Colors.dark,
  },
  highlight: {
    fontWeight: '700',
  },
  footer: {
    color: Colors.dark,
    fontSize: 12,
    fontWeight: '600',
    padding: 4,
    paddingRight: 12,
    textAlign: 'right',
  },
});

export default App;
