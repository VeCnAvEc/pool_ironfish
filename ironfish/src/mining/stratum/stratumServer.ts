/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
 import net from 'net'
 import { isValidPublicAddress } from '../../account/validator'
 import { Assert } from '../../assert'
 import { GRAFFITI_SIZE } from '../../consensus/consensus'
 import { Config } from '../../fileStores/config'
 import { createRootLogger, Logger } from '../../logger'
 import { SerializedBlockTemplate } from '../../serde/BlockTemplateSerde'
 import { GraffitiUtils, StringUtils } from '../../utils'
 import { ErrorUtils } from '../../utils/error'
 import { YupUtils } from '../../utils/yup'
 import { MiningPool } from '../pool'
 import { mineableHeaderString } from '../utils'
 import { ClientMessageMalformedError } from './errors'
 import { MiningPoolMiner } from '../poolMiner'
 import {
   MiningNotifyMessage,
   MiningSetTargetMessage,
   MiningSubmitSchema,
   MiningSubscribedMessage,
   MiningSubscribeSchema,
   StratumMessage,
   StratumMessageSchema,
 } from './messages'
 
 let numberOfUsers: number = 0
 
 
 export const givenHash = {
   hash: 0
 }
 
 export class StratumServerClient {
   id: number
   socket: net.Socket
   connected: boolean
   subscribed: boolean
   publicAddress: string | null = null
   graffiti: Buffer | null = null
 
   private constructor(options: { socket: net.Socket; id: number }) {
     this.id = options.id
     this.socket = options.socket
     this.connected = true
     this.subscribed = false
   }
 
   static accept(socket: net.Socket, id: number): StratumServerClient {
     return new StratumServerClient({ socket, id })
   }
 
   close(error?: Error): void {
     if (!this.connected) {
       return
     }
 
     this.connected = false
     this.socket.destroy(error)
   }
 }
 
 export class StratumServer {
   readonly server: net.Server
   readonly pool: MiningPool
   readonly config: Config
   readonly logger: Logger
 
   readonly port: number
   readonly host: string
 
   publickey: string | null = ''
   clients: Map<number, StratumServerClient>
   nextMinerId: number
   nextMessageId: number
 
   currentWork: Buffer | null = null
   currentMiningRequestId: number | null = null
 
   constructor(options: {
     pool: MiningPool
     config: Config
     logger?: Logger
     port?: number
     host?: string
   }) {
     this.pool = options.pool
     this.config = options.config
     this.logger = options.logger ?? createRootLogger()
 
     this.host = options.host ?? this.config.get('poolHost')
     this.port = options.port ?? this.config.get('poolPort')
 
     this.clients = new Map()
     this.nextMinerId = 0
     this.nextMessageId = 0
 
     this.server = net.createServer((s) => this.onConnection(s))
   }
 
   start(): void {
     this.server.listen(this.port, this.host)
   }
 
   stop(): void {
     this.server.close()
   }
 
   getTime() {
     let today = new Date();
     let dd = String(today.getDate()).padStart(2, '0');
     let month = String(today.getMonth() + 1).padStart(2, '0'); //January is 0!
     let year = today.getFullYear();
     let hours = String(today.getHours()).padStart(2, '0')
     let minutes = String(today.getMinutes()).padStart(2, '0')
 
     return `${dd}-${month}-${year}, ${hours}:${minutes} `
   }
 
   async getPoolDB() {
     let users = this.clients.values()
 
     const online = true
 
     for (let user of users) {
       this.publickey = user.publicAddress
     }
 
     numberOfUsers = this.clients.size
     if (numberOfUsers > 0) {
       this.pool.createUserFields(this.publickey, this.getTime(), online, this.getTime())
     }
   }
 
   async userHashRate() {
     let userHash = await this.pool.userHashRate(this.publickey)
     return userHash
   }
 
   myLog() {
     return this.clients.size > 0 ? this.clients.size : '0'
   }
 
   activeClients() {
     setInterval(() => {
       return this.clients.size < 1 ? this.clients.size : '0'
     }, 1000)
   }
 
   newWork(miningRequestId: number, block: SerializedBlockTemplate): void {
     this.getPoolDB()
 
     this.currentMiningRequestId = miningRequestId
     this.currentWork = mineableHeaderString(block.header)
 
     this.logger.info(
       'Setting work for request:',
       this.currentMiningRequestId,
       `${this.currentWork.toString('hex').slice(0, 50)}...`,
     )
 
     this.broadcast('mining.notify', this.getNotifyMessage())
   }
 
   waitForWork(): void {
     this.broadcast('mining.wait_for_work')
   }
 
   hasWork(): boolean {
     return this.currentWork != null
   }
 
   private onConnection(socket: net.Socket): void {
     const client = StratumServerClient.accept(socket, this.nextMinerId++)
 
     socket.on('data', (data: Buffer) => {
       this.onData(client, data).catch((e) => this.onError(client, e))
     })
 
     socket.on('close', () => this.onDisconnect(client))
 
     socket.on('error', (e) => this.onError(client, e))
 
     this.logger.debug(`Client ${client.id} connected:`, socket.remoteAddress)
     this.clients.set(client.id, client)
 
     setTimeout(() => {
       let connectedClient = this.clients.values()
 
       for (let user of connectedClient) {
         if (user.publicAddress !== null) {
           this.pool.setOnlineUser(user.publicAddress)
         }
       }
     }, 10000)
   }
 
   private onDisconnect(client: StratumServerClient): void {
     let disconectUser = client
 
     this.logger.debug(`Client ${client.id} disconnected`)
     client.socket.removeAllListeners()
     this.clients.delete(client.id)
 
     if (disconectUser.publicAddress !== null) {
       this.pool.setOfflineUser(disconectUser.publicAddress, this.getTime())
     }
   }
 
   private async onData(client: StratumServerClient, data: Buffer): Promise<void> {
     const splits = data.toString('utf-8').trim().split('\n')
 
     for (const split of splits) {
       const payload: unknown = JSON.parse(split)
 
       const header = await YupUtils.tryValidate(StratumMessageSchema, payload)
 
       if (header.error) {
         throw new ClientMessageMalformedError(client, header.error)
       }
 
       this.logger.debug(`Client ${client.id} sent ${header.result.method} message`)
 
       switch (header.result.method) {
         case 'mining.subscribe': {
           const body = await YupUtils.tryValidate(MiningSubscribeSchema, header.result.body)
 
           if (body.error) {
             throw new ClientMessageMalformedError(client, body.error, header.result.method)
           }
 
           client.publicAddress = body.result.publicAddress
           client.subscribed = true
 
           if (!isValidPublicAddress(client.publicAddress)) {
             throw new ClientMessageMalformedError(
               client,
               `Invalid public address: ${client.publicAddress}`,
               header.result.method,
             )
           }
 
           const idHex = client.id.toString(16)
           const graffiti = `${this.pool.name}.${idHex}`
           Assert.isTrue(StringUtils.getByteLength(graffiti) <= GRAFFITI_SIZE)
           client.graffiti = GraffitiUtils.fromString(graffiti)
 
           this.logger.info(`Miner ${idHex} connected`)
 
           this.send(client, 'mining.subscribed', { clientId: client.id, graffiti: graffiti })
           this.send(client, 'mining.set_target', this.getSetTargetMessage())
 
           if (this.hasWork()) {
             this.send(client, 'mining.notify', this.getNotifyMessage())
           }
 
           break
         }
 
         case 'mining.submit': {
           const body = await YupUtils.tryValidate(MiningSubmitSchema, header.result.body)
 
           if (body.error) {
             throw new ClientMessageMalformedError(client, body.error)
           }
 
           const submittedRequestId = body.result.miningRequestId
           const submittedRandomness = body.result.randomness
 
           void this.pool.submitWork(client, submittedRequestId, submittedRandomness)
 
           break
         }
 
         default:
           throw new ClientMessageMalformedError(
             client,
             `Invalid message ${header.result.method}`,
           )
       }
     }
   }
 
   private onError(client: StratumServerClient, error: unknown): void {
     this.logger.debug(
       `Error during handling of data from client ${client.id}: ${ErrorUtils.renderError(
         error,
         true,
       )}`,
     )
 
     client.close()
   }
 
   private getNotifyMessage(): MiningNotifyMessage {
     Assert.isNotNull(this.currentMiningRequestId)
     Assert.isNotNull(this.currentWork)
 
     return {
       miningRequestId: this.currentMiningRequestId,
       header: this.currentWork?.toString('hex'),
     }
   }
 
   private getSetTargetMessage(): MiningSetTargetMessage {
     return {
       target: this.pool.getTarget(),
     }
   }
 
   private broadcast(method: 'mining.wait_for_work'): void
   private broadcast(method: 'mining.notify', body: MiningNotifyMessage): void
   private broadcast(method: string, body?: unknown): void {
     const message: StratumMessage = {
       id: this.nextMessageId++,
       method: method,
       body: body,
     }
 
     const serialized = JSON.stringify(message) + '\n'
 
     for (const client of this.clients.values()) {
       client.socket.write(serialized)
     }
   }
   private send(
     client: StratumServerClient,
     method: 'mining.notify',
     body: MiningNotifyMessage,
   ): void
   private send(
     client: StratumServerClient,
     method: 'mining.set_target',
     body: MiningSetTargetMessage,
   ): void
   private send(
     client: StratumServerClient,
     method: 'mining.subscribed',
     body: MiningSubscribedMessage,
   ): void
   private send(client: StratumServerClient, method: string, body?: unknown): void {
     const message: StratumMessage = {
       id: this.nextMessageId++,
       method: method,
       body: body,
     }
 
     const serialized = JSON.stringify(message) + '\n'
     client.socket.write(serialized)
   }
 }
 