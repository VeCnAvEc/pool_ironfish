"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const file_1 = require("../../utils/file");
const manager_1 = require("../manager");
const fileSystems_1 = require("../../fileSystems");
const sqlite3_1 = __importDefault(require("sqlite3"));
const express = require('express');
const app = express();
const path = require('path');
const port = Number(process.env.PORT) || 80;
const host = '159.65.94.202';
let pointsReceived = 0;
if (manager_1.RESULT_SUCCESS_OR_NOTSUCCESSFUL) {
    pointsReceived += 20;
}
class webApi {
    constructor(options) {
        this.rpc = options.pool.rpc;
        this.config = options.config;
        this.pool = options.pool;
        this.StratumServer = options.StratumServer;
        this.hashRate = options.hashRate;
        this.currentRequetId = options.currentRequetId;
    }
    setViwes() {
        app.set('viwes engine', 'hbs');
        app.set('viwes', './views');
        app.use(express.static(path.join(__dirname, 'views/public')));
    }
    async setRoutes() {
        this.setViwes();
        const currnetMiners = () => {
            return this.StratumServer.myLog();
        };
        await app.get("/", async (req, res) => {
            let hash = await this.pool.estimateHashRate();
            let luck = await this.pool.lucky() == 15000 ? 0 : await this.pool.lucky();
            let countBlock = await this.pool.miningRequestBlocks;
            res.render('main.hbs', {
                counterHashRate: `${file_1.FileUtils.formatHashRate(hash)}/s`,
                poolMiners: currnetMiners,
                currentRequetId: parseFloat(String(luck.toFixed(4))),
                pointsReceived: pointsReceived,
                countBlock: countBlock
            });
        });
        this.listen();
    }
    findUser() {
        const urlencodedParser = express.urlencoded({ extended: false });
        app.post("/finduser", urlencodedParser, async (req, res) => {
            if (!req.body)
                return res.sendStatus(400);
            let userInfo;
            const fs = new fileSystems_1.NodeFileProvider();
            await fs.init();
            let publicAddress = req.body.publickey;
            const poolFolder = fs.join(this.config.dataDir, '/pool');
            const db = new sqlite3_1.default.Database(`${poolFolder}/database.sqlite`, sqlite3_1.default.OPEN_READWRITE, (err) => {
                if (err)
                    throw err;
            });
            await db.all('SELECT * FROM farmer', async (err, allRows) => {
                if (err)
                    throw err.message;
                await allRows.map((item) => {
                    if (item.publicAddress === publicAddress) {
                        return userInfo = item;
                    }
                    return userInfo;
                });
            });
            res.render('finduser.hbs', {
                publicAddress: userInfo?.publicAddress
            });
        });
    }
    listen() {
        app.listen(port, host, () => {
            console.log(`Listening to requests on http://${host}:${port}`);
        });
    }
    start() {
        this.setRoutes();
        this.findUser();
    }
}
exports.default = webApi;
//# sourceMappingURL=app.js.map