import React from "react";
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
  TouchableHighlight
} from "react-native";

import { Colors } from "react-native/Libraries/NewAppScreen";
import AsyncStorage from "@react-native-async-storage/async-storage";

import BleManager from "react-native-ble-manager";
const BleManagerModule = NativeModules.BleManager;
const bleManagerEmitter = new NativeEventEmitter(BleManagerModule);

// nb: react-native-crypto has a dependency issue;
// library used seems less good but ok for our purposes
// https://github.com/juhoen/hybrid-crypto-js
import { Crypt, RSA } from "hybrid-crypto-js";
import "react-native-get-random-values";

const KEYSHARE_HEADER = "DENSE keyshare";
const EXPOSURE_HEADER = "DENSE exposure";

import Contacts from 'react-native-contacts';
import EncryptedStorage from 'react-native-encrypted-storage';

/*
const retrieveUserSession = async() => {
  try {
    const session = await EncryptedStorage.getItem('contacts');

    if (session !== undefined) {
      // Congrats! You've just retrieved your first value!
    } else {
      Contacts.getAll().then(async (contacts) => {
        // contacts returned
        //  hash then store
        let phones = [];
        contacts.forEach(contact => phones.push(contact.phoneNumbers.filter(obj => obj.label === 'mobile')[0].number));
        let hashed;
        await EncryptedStorage.setItem(
          'contacts',
          JSON.stringify([hashed, new Date().getTime()])
        );
      });
    }
  } catch (error) {
    // There was an error on the native side
    console.error('Error in retrieveUserSession: ', error);
  }
}
*/

const App = () => {
  const [isScanning, setIsScanning] = React.useState(false);
  const peripherals = new Map();

  // TODO: extract from persistent storage
  let contactKeyToTime = new Map();
  let notifications = new Set();

  const [list, setList] = React.useState([]);
  var publicKey, privateKey;
  const crypt = new Crypt({ md: "sha256" });

  React.useEffect(() => {
    // Initialize public and private keys
    var rsa = new RSA({ entropy: 244 });
    rsa.generateKeyPair(function (keys) {
      console.log(keys);
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
    }, 1024);

    BleManager.start({ showAlert: false });

    bleManagerEmitter.addListener(
      "BleManagerDiscoverPeripheral",
      handleDiscoverPeripheral
    );
    bleManagerEmitter.addListener("BleManagerStopScan", handleStopScan);
    bleManagerEmitter.addListener(
      "BleManagerDisconnectPeripheral",
      handleDisconnectedPeripheral
    );
    bleManagerEmitter.addListener(
      "BleManagerDidUpdateValueForCharacteristic",
      handleUpdateValueForCharacteristic
    );
    retrieveUserSession();
  }, []);

  const startScan = () => {
    if (!isScanning) {
      // scan for 5 seconds
      BleManager.scan([], 5, true)
        .then((results) => {
          console.log("Scanning...");
          setIsScanning(true);
        })
        .catch((err) => {
          console.error(err);
        });
    }
  };

  const handleStopScan = () => {
    console.log("Scan is stopped");
    setIsScanning(false);
  };

  const handleDisconnectedPeripheral = (data) => {
    let peripheral = peripherals.get(data.peripheral);
    if (peripheral) {
      peripheral.connected = false;
      peripherals.set(peripheral.id, peripheral);
      setList(Array.from(peripherals.values()));
    }
    console.log("Disconnected from " + data.peripheral);
  };

  const handleUpdateValueForCharacteristic = (data) => {
    console.log(
      "Received data from " +
        data.peripheral +
        " characteristic " +
        data.characteristic,
      data.value
    );
  };

  const retrieveConnected = () => {
    BleManager.getConnectedPeripherals([]).then((results) => {
      if (results.length == 0) {
        console.log("No connected peripherals");
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
    console.log("Got ble peripheral", peripheral);
    if (!peripheral.name) {
      peripheral.name = "NO NAME";
    }
    peripherals.set(peripheral.id, peripheral);
    setList(Array.from(peripherals.values()));
  };

  const testPeripheral = (peripheral) => {
    if (peripheral) {
      if (peripheral.connected) {
        BleManager.disconnect(peripheral.id);
      } else {
        BleManager.connect(peripheral.id)
          .then(() => {
            let p = peripherals.get(peripheral.id);
            if (p) {
              p.connected = true;
              peripherals.set(peripheral.id, p);
              setList(Array.from(peripherals.values()));
            }
            console.log("Connected to " + peripheral.id);

            setTimeout(() => {
              /* Test read current RSSI value */
              BleManager.retrieveServices(peripheral.id).then(
                (peripheralData) => {
                  console.log("Retrieved peripheral services", peripheralData);

                  BleManager.readRSSI(peripheral.id).then((rssi) => {
                    console.log("Retrieved actual RSSI value", rssi);
                    let p = peripherals.get(peripheral.id);
                    if (p) {
                      p.rssi = rssi;
                      peripherals.set(peripheral.id, p);
                      setList(Array.from(peripherals.values()));
                    }
                  });
                }
              );
            }, 900);
          })
          .catch((error) => {
            console.log("Connection error", error);
          });
      }
    }
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
    console.log("Encrypted", toEncrypt, " and got back", decrypted);
  };

  /* Generate a trivial key advertisement message.
   */
  const genKeyShareMessage = () => {
    /* TODO: maybe include and sign time, to prevent someone from advertising
      someone else's key with a copy of the message? */
    const time = Date.now();
    const msg = {
      header: KEYSHARE_HEADER,
      pk: publicKey,
      time: time
    };
    return msg;
  };

  const sanityCheck = (encrypted) => {
    const decrypted = crypt.decrypt(privateKey, encrypted);
    const verified = crypt.verify(
      publicKey,
      decrypted.signature,
      decrypted.message
    );
    if (verified) {
      console.log("Encryption and signature passes sanity check!");
      console.log("Decrypted message: ", decrypted.message);
    }
  };

  /* Generate an exposure notification message. Messages include a header,
   * time (if >a week ago, stop forwarding), and signed, encrypted
   * [sender's public key, time that message was sent]. (The time can't be verified/signed
   * as the message may be forwarded by intermediaries who shouldn't know the sender's identity.)
   */
  const genExposureNotification = () => {
    // Encrypted information
    const time = Date.now();
    const salt = crypto.getRandomValues(new Int32Array([244]))[0];
    const message = {
      sender_pk: publicKey,
      time: time,
      salt: salt,
    };
    const signature = crypt.signature(privateKey, message);

    const encrypted = crypt.encrypt(
      contactKeyToTime.keys(),
      JSON.stringify(message),
      signature
    );

    const msg = { header: EXPOSURE_HEADER, time: time, message: encrypted };
    sanityCheck(msg.message);

    return msg;
  };

  /* Processes a key-share message. The message should be of the following format:
   * - header: should be equal to KEYSHARE_HEADER
   * - message: should contain a public key
   */
  const processKeyShareMessage = (msg) => {
    const message = JSON.parse(msg);
    const time = message.time;
    const pk = message.pk;
    const nonce = crypto.randomBytes(16); // 128-bit nonce
    console.log(`received keyshare message at time ${time}: (${pk}, ${phoneNo}, ${nonce})`);
    // Log message info
    contactKeyToTime[pk] = message.time;
  };

  /* Processes an exposure notification message. The message should be of the following format:
   * - header: should be equal to EXPOSURE_HEADER
   * - time: time when message was sent
   * - message: JSON object { pk, time, salt } encrypted with the recipient's public key
   */
  const processExposureMessage = (msg) => {
    
    const message = JSON.parse(msg);
    // Ignore notifications more than a week old
    if (Date.now() - message.time >= 7 * 24 * 60 * 60 * 1000) {
      console.log(`ignoring stale exposure message`);
      return;
    }

    // Check if message has already been received
    if (notifications.has(message)) {
      console.log("Message already contained in notifications.");
      return;
    }
    
    // Add to notification storage
    notifications.add(msg);

    let decrypted = null;
    try {
      decrypted = crypt.decrypt(privateKey, message.msg);
    } catch (error) {
      return;
    }

    const verified = crypt.verify(
      message.sender_pk,
      decrypted.signature,
      decrypted.message
    );

    if (!verified) {
      console.log("Received exposure notification with incorrect signature.");
    }

    // Check if key belongs to close contact
    if (contactKeyToTime.has(message.sender_pk)) {
      console.log(`Exposure for key ${message.sender_pk}, in close contact at time ${contactKeyToTime[message.sender_pk]}`);
      // Send notification to user
    }
  };

  const renderItem = (item) => {
    const color = item.connected ? "green" : "#fff";
    return (
      <TouchableHighlight onPress={() => testPeripheral(item)}>
        <View style={[styles.row, { backgroundColor: color }]}>
          <Text
            style={{
              fontSize: 12,
              textAlign: "center",
              color: "#333333",
              padding: 10,
            }}
          >
            {item.name}
          </Text>
          <Text
            style={{
              fontSize: 10,
              textAlign: "center",
              color: "#333333",
              padding: 2,
            }}
          >
            RSSI: {item.rssi}
          </Text>
          <Text
            style={{
              fontSize: 8,
              textAlign: "center",
              color: "#333333",
              padding: 2,
              paddingBottom: 20,
            }}
          >
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
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          style={styles.scrollView}
        >
          {global.HermesInternal == null ? null : (
            <View style={styles.engine}>
              <Text style={styles.footer}>Engine: Hermes</Text>
            </View>
          )}
          <View style={styles.body}>
            <View style={{ margin: 10 }}>
              <Button
                title={"Scan Bluetooth (" + (isScanning ? "on" : "off") + ")"}
                onPress={() => startScan()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Retrieve connected peripherals"
                onPress={() => retrieveConnected()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Generate a fresh key pair (may take a while)"
                onPress={() => genKeyPair()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Encrypt and decrypt a message"
                onPress={() => testCrypto()}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Print a key share to the console"
                onPress={() => console.log(genKeyShareMessage())}
              />
            </View>

            <View style={{ margin: 10 }}>
              <Button
                title="Print an exposure notification to the console"
                onPress={() => console.log(genExposureNotification())}
              />
            </View>

            {list.length == 0 && (
              <View style={{ flex: 1, margin: 20 }}>
                <Text style={{ textAlign: "center" }}>No peripherals</Text>
              </View>
            )}
          </View>
        </ScrollView>
        <FlatList
          data={list}
          renderItem={({ item }) => renderItem(item)}
          keyExtractor={(item) => item.id}
        />
      </SafeAreaView>
    </>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    backgroundColor: Colors.lighter,
  },
  engine: {
    position: "absolute",
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
    fontWeight: "600",
    color: Colors.black,
  },
  sectionDescription: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "400",
    color: Colors.dark,
  },
  highlight: {
    fontWeight: "700",
  },
  footer: {
    color: Colors.dark,
    fontSize: 12,
    fontWeight: "600",
    padding: 4,
    paddingRight: 12,
    textAlign: "right",
  },
});

export default App;
