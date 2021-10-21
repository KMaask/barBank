const mongoose = require('mongoose')
const Session = require("./models/Session")
const Transaction = require("./models/Transaction")
const Bank = require("./models/Bank")
const Account = require("./models/Account")
const fetch = require("node-fetch")
const jose = require('node-jose')
const fs = require('fs')

exports.verifyToken = async (req, res, next) => {

    // Check Authorization header exists
    let authorizationHeader = req.header('Authorization')
    if (!authorizationHeader) {
        return res.status(401).send({error: 'Missing Authorization header'})
    }

    // Split Authorization header by space
    authorizationHeader = authorizationHeader.split(' ')

    // Check that Authorization header includes a space
    if (!authorizationHeader[1]) {
        return res.status(401).send({error: 'Invalid Authorization header format'})
    }

    // Validate that the provided token conforms to MongoDB id format
    if (!mongoose.Types.ObjectId.isValid(authorizationHeader[1])) {
        return res.status(401).send({error: 'Invalid token'})
    }

    // Find a session with given token
    const session = await Session.findOne({_id: authorizationHeader[1]})

    // Check that the session existed
    if (!session) return res.status(401).send({error: 'Invalid token'})

    // Store the user's id in the req objects
    req.userId = session.userId
    req.sessionId = session.id

    return next();
}

exports.refreshListOfBanksFromCentralBank = async function refreshListOfBanksFromCentralBank() {
    console.log('Refreshing list of banks')

    try {

        // Attempt to get JSON list of banks from central bank
        let banks = await fetch(process.env.CENTRAL_BANK_URL, {
            headers: {'Api-Key': process.env.CENTRAL_BANK_APIKEY}
        }).then(responseText => responseText.json())

        // Delete all banks from banks collection
        await Bank.deleteMany()
        const bulk = Bank.collection.initializeUnorderedBulkOp()

        banks.forEach(bank => {
            bulk.insert(bank)
        })

        // bulk insert into DB
        await bulk.execute()
        console.log('Done')
        return true

    } catch (e) {
        console.log('Failed to communicate with Central: '+ e.message)
        return {error: e.message}
    }
}

function isExpired(transaction) {
    const nowPlus3Days = new Date(transaction.createdAt.setDate(transaction.createdAt.getDate() + 3))

    return new Date > nowPlus3Days
}

async function setStatus(transaction, status, statusDetail) {
    transaction.status = status
    transaction.statusDetail = statusDetail
    try {
        await transaction.save()
    } catch (e) {
        transaction.statusDetail = statusDetail
    }
}

async function createJwtString(input)  {

        // Create jwt
        let privateKey

        try {
            privateKey = fs.readFileSync('private.key', 'utf8')
            console.log('privateKey: ' + privateKey)
            const keystore = jose.JWK.createKeyStore();
            const key = await keystore.add(privateKey, 'pem')
            return await jose.JWS.createSign({format: 'compact'}, key).update(JSON.stringify(input), 'utf8').final()

        } catch (err) {
            console.error('Error reading private key' + err)
            throw Error('Error reading private key' + err)
        }
}


async function sendRequestToDestinationBank(accountToBank, jwt) {
    return await exports.sendPostRequest(accountToBank.transactionUrl, {jwt: jwt});
}

exports.sendPostRequest = async (url, data) => {
    return await exports.sendRequest('post', url, data)
}

exports.sendGetRequest = async (url) => {
    return await exports.sendRequest('get', url, null)
}

exports.sendRequest = async (method, url, data) => {
    let responseText = '';

    let options = {
        method,
        headers: {'Content-Type': 'application/json'}
    }

    if (data) {
        options.body = JSON.stringify(data)
    }

    try {
        let response = await fetch(url, options);

        // response to text
        responseText = await response.text()
        return JSON.parse(responseText);

    } catch (e) {
        throw new Error('sendRequest('+url+'): ' + e.message +  (typeof responseText === 'undefined' ? '': '|' + responseText))
    }
}

async function refund(transaction) {
    try {
        const accountFrom = Account.findOne({number: transaction.accountFrom})
        console.log('Refunding transaction ' + transaction._id + 'by ' + transaction.amount)
        accountFrom.balance += transaction.amount
        await accountFrom.balance.save()
    } catch (e) {
        console.log('Error refunding account: ')
        console.log('Reason: ' + e.message)
    }
}

exports.processTransactions = async function () {

   //console.log('Running processTransactions')

    // Get pending transactions
    const pendingTransactions = await Transaction.find({status: 'Pending'})

    // Loop trough all pending transactions
    pendingTransactions.forEach(async transaction => {

        let accountToBank;

        // Assert that the transaction has not expired
        if (isExpired(transaction)) {
            await refund(transaction)
            return setStatus(transaction, 'Failed', 'Expired')
        }

        //Set transaction status to 'in progress'
        console.log('In progress transaction ' + transaction._id)
        await setStatus(transaction, 'In progress');

        // Get the bank of accountTo
        let bankPrefix = transaction.accountTo.substring(0, 3)
        accountToBank = await Bank.findOne({bankPrefix})

        // if we don't have the bank in local database
        if (!accountToBank) {
            let result = exports.refreshListOfBanksFromCentralBank()
            if (typeof result.error !== 'undefined') {
                return setStatus(transaction, 'Pending', 'Central bank refresh failed: ' + result.error)
            }


            accountToBank = Bank.findOne({bankPrefix});
            if (!accountToBank) {
                await refund(transaction)
                return setStatus(transaction, 'Failed', 'Bank' + bankPrefix + 'does not exist')
            }
        }

        try {
           const response = await sendRequestToDestinationBank(accountToBank, await createJwtString({
                accountFrom: transaction.accountFrom,
                accountTo: transaction.accountTo,
                amount: transaction.amount,
                currency: transaction.currency,
                explanation: transaction.explanation,
                senderName: transaction.senderName,
            }));

           console.log(response)

            if (!response.receiverName) {
                return await setStatus(transaction, 'Failed', JSON.stringify((response)))
            }

            if(typeof response.error !== 'undefined') {
                return await setStatus(transaction, 'Failed', response.error)
            }

            transaction.receiverName = response.receiverName
            console.log('Completed transaction ' + transaction._id)
            return await setStatus(transaction, 'Completed', '')

        } catch (e) {
            console.log('Error sending request to destination bank: ')
            console.log('- Transaction id is:' + e.message)
            return await setStatus(transaction, 'Pending', e.message)
        }

    }, Error)

    // Recursively call itself again
    setTimeout(exports.processTransactions, 1000)
}