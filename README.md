# CS244b final proj

pre-reqs:\
node v17.4.0\
-if not installed, install nvm (node version manager)\
xcode that can support whatever iOS version your iphone is.

For demo purposes, you'll need to clone the server repo https://github.com/ruslanjabari/DENSeServer

# installation
git clone the repo\
cd into project\
npm install\
^(again make sure your node version is 17.4.0, you can find out by typing node -v)\
cd into ios folder\
npx pod-install\
open trial3.xcworkspace using xcode\
^make sure it's the .xcworkspace and NOT .xcodeproj file\
in Signing & Capabilities, change the team to your personal apple account\
Then change the bundle identifier (trail3 & trial32 are taken)\
Connect your iphone, change the target to it.\
Build!
