const jwt = require('jsonwebtoken');
const fs = require('fs');
const request = require('request');

const RS = require('./session');

class InfobotYandexSTT {
    static get FORMAT_OPUS() {
        return 'OGG_OPUS';
    }

    static get FORMAT_PCM() {
        return 'LINEAR16_PCM';
    }

    constructor(serviceAccountID, keyID, folderID, keyData) {
        this.serviceAccountID = serviceAccountID;
        this.keyID = keyID;
        this.folderID = folderID;
        this.keyData = keyData;
        this.token = null;

        if (!this.serviceAccountID) throw new Error('No Service Account ID provided');
        if (!this.keyID) throw new Error('No Key ID provided');
        if (!this.folderID) throw new Error('No Folder ID provided');
        if (!this.keyData) throw new Error('No Private Key provided');
    }

    generateToken() {
        const self = this;
        return new Promise((resolve, reject) => {
            if (!(self.token && self.tokenExpire && self.tokenExpire < Math.floor(new Date() / 1000))) {
                const expire = Math.floor(new Date() / 1000) + 60;

                const payload = {
                    'aud': 'https://iam.api.cloud.yandex.net/iam/v1/tokens',
                    'iss': this.serviceAccountID,
                    'iat': Math.floor(new Date() / 1000),
                    'exp': expire
                };

                const header = {
                    'alg': 'PS256',
                    'typ': 'JWT',
                    'kid': this.keyID
                };


                const tokenJWT = jwt.sign(payload, fs.readFileSync('./yandex.pem'), {
                    algorithm: 'PS256',
                    keyid: this.keyID
                });

                request.post(
                    'https://iam.api.cloud.yandex.net/iam/v1/tokens',
                    {json: {jwt: tokenJWT}},
                    function (error, response, body) {
                        if (!error && parseInt(response.statusCode) === 200) {
                            self.token = body.iamToken;
                            self.tokenExpire = expire;
                            resolve(self.token);
                        } else {
                            reject(error);
                        }
                    }
                );
            } else {
                resolve(self.token);
            }
        });
    }

    startRecognitionSession(specification) {
        const self = this;
        return new Promise((resolve, reject) => {
            self.generateToken().then(function (token) {
                if (!specification) specification = {};
                specification.language_code = specification.language_code || 'ru-RU';
                specification.sample_rate_hertz = specification.sample_rate_hertz || 8000;
                specification.audio_encoding = specification.audio_encoding || InfobotYandexSTT.FORMAT_PCM;
                specification.profanity_filter = specification.profanity_filter || false;
                specification.partial_results = specification.partial_results || true;

                resolve(new RS(token, specification, self.folderID));
            }).catch(function (err) {
                reject(err);
            });
        });
    }

    recognizeFile(path, specification) {
        const self = this;
        return new Promise((resolve, reject) => {
            if (fs.existsSync(path)) {
                self.startRecognitionSession(specification).then((recSess) => {
                    const Writable = require('stream').Writable;
                    const ws = Writable();
                    ws._write = function (chunk, enc, next) {
                        recSess.writeChunk(chunk);
                        next();
                    };

                    const readStream = fs.createReadStream(path);
                    readStream.pipe(ws);

                    readStream.on("end", function () {
                        recSess.finishStream();
                    });

                    recSess.on('data', function (data) {
                        if (data && data.chunks && data.chunks[0].final) {
                            resolve(data.chunks[0].alternatives[0]);
                        }
                    });

                    recSess.on('error', function (data) {
                        reject(data);
                    });
                }).catch((err) => {
                    reject(err);
                });
            } else {
                throw new Error(`File not found ${path}`);
            }
        });
    }
}

module.exports = InfobotYandexSTT;