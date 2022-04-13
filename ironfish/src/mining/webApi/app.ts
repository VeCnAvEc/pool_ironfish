import { Config } from "../../fileStores"
import { MiningPool } from '../pool';
import { IronfishIpcClient } from '../../rpc/clients'
import { FileUtils } from '../../utils/file'
import { StratumServer } from "../stratum/stratumServer"
import { Meter } from "../../metrics";
import { RESULT_SUCCESS_OR_NOTSUCCESSFUL } from "../manager";
import { NodeFileProvider } from "../../fileSystems";
import sqlite3 from "sqlite3";

const express = require('express')
const app = express()
const path = require('path');
const port = Number(process.env.PORT) || 5864;
const host = '192.168.1.147';

let pointsReceived = 0

if( RESULT_SUCCESS_OR_NOTSUCCESSFUL ) {
    pointsReceived += 20
}

export default class webApi {
    currentRequetId: number

    readonly pool: MiningPool
    readonly config: Config
    readonly rpc: IronfishIpcClient
    readonly StratumServer: StratumServer
    readonly hashRate: Meter

    readonly host?: string
    readonly port?: number

    userInfo: any

    constructor(options: {
        pool: MiningPool,
        config: Config,
        rpc: IronfishIpcClient,
        StratumServer: StratumServer,
        hashRate: Meter,
        currentRequetId: number
        host?: string,
        port?: number
    }) {
        this.rpc = options.pool.rpc;
        this.config = options.config;
        this.pool = options.pool;
        this.StratumServer = options.StratumServer;
        this.hashRate = options.hashRate
        this.currentRequetId = options.currentRequetId
    }

    setViwes() {
        app.set('viwes engine', 'hbs');
        app.set('viwes', './views');
        app.use(express.static(path.join(__dirname, 'views/public')));
    }
    
    async setRoutes() {
        this.setViwes();

        const currnetMiners = () => {
            return this.StratumServer.myLog()
        }

        await app.get("/", async (req: any, res: any) => {
            let hash = await this.pool.estimateHashRate();
            let luck = await this.pool.lucky() == 15000 ? 0 : await this.pool.lucky();
            let countBlock = await this.pool.miningRequestBlocks

            res.render('main.hbs', {
                counterHashRate: `${FileUtils.formatHashRate(hash)}/s`,
                poolMiners: currnetMiners,
                currentRequetId: parseFloat(String(luck.toFixed(4))),
                pointsReceived: pointsReceived,
                countBlock: countBlock
            });
        });
        this.listen();
    }

    async findUser() {
        const urlencodedParser = express.urlencoded({extended: false});

        app.post("/finduser", urlencodedParser, async (req: any, res: any) => {
            if(!req.body) return res.sendStatus(400);            
    
            let hash = await this.StratumServer.userHashRate()

            const fs = new NodeFileProvider()
            await fs.init()
            
            let publicAddress = req.body.publickey 

            const poolFolder = fs.join(this.config.dataDir, '/pool')
    
            const db = new sqlite3.Database(`${poolFolder}/database.sqlite`,
             sqlite3.OPEN_READWRITE, ( err ) => {
                if ( err ) throw err
            })

            // const getAllUsers = new Promise( async (resolve, reject) => {
            //     await fsda
            // })

            await db.all('SELECT * FROM farmer', async (err, allRows) => {
                if ( err ) throw err.message

                return await allRows.find((user) => {
                    if ( user.publicAddress === publicAddress ) {
                        this.userInfo = user
                        console.log(this.userInfo)
                    }
                })
            })

            console.log(this.userInfo)

            res.render('finduser.hbs', {
                mistake: 'If you see the data of the previous user, then reload the page',
                publicAddress: this.userInfo?.publicAddress ? this.userInfo.publicAddress  : 'Reload the page',
                timestamp: this.userInfo?.timestamp ? this.userInfo?.timestamp  : 'Reload the page',
                lastMining: this.userInfo?.lastMining ? this.userInfo?.lastMining  : 'Reload the page',
                online: this.userInfo?.online < 1 ? 'offline' : 'online',
                hashRate: await FileUtils.formatHashRate(hash)
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
        this.findUser()
    }
}