const fs = require('fs');
const d = fs.readdirSync('/tmp', { withFileTypes: true })[0];
try { console.log('isFile', d.isFile()); } catch (e) { console.log('isFile THREW'); }
try { console.log('isDirectory', d.isDirectory()); } catch (e) { console.log('isDirectory THREW'); }
try { console.log('isSymbolicLink', d.isSymbolicLink()); } catch (e) { console.log('isSymbolicLink THREW'); }
try { console.log('isBlockDevice', d.isBlockDevice()); } catch (e) { console.log('isBlockDevice THREW'); }
try { console.log('isCharacterDevice', d.isCharacterDevice()); } catch (e) { console.log('isCharacterDevice THREW'); }
try { console.log('isFIFO', d.isFIFO()); } catch (e) { console.log('isFIFO THREW'); }
try { console.log('isSocket', d.isSocket()); } catch (e) { console.log('isSocket THREW'); }
