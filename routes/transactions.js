const router = require('express').Router();
const User = require('../models/User');
const Account = require('../models/Account');
const Bank = require('../models/Bank');
const Transaction = require('../models/Transaction');
const {verifyToken, refreshListOfBanksFromCentralBank, sendGetRequest} = require("../middlewares");
const base64url = require('base64url');
const jose = require('node-jose');
const fs = require('fs');
const axios = require("axios");


router.post('/', verifyToken, async function (req,res) {

    function debitAccount(accountFrom, amount) {
        accountFrom.balance -= amount
        accountFrom.save()
    }

    try {
        let statusDetail;

        //check that accountForm exists and belongs to user
        const accountFrom = await Account.findOne({number: req.body.accountFrom, userId: req.userId})
        if(!accountFrom) {
            return res.status(404).send({error: 'accountFrom not found'})
        }

        if(!accountFrom) {
            return res.status(404).send({error: 'accountFrom not found'})
        }


        //check for funds
        if(req.body.amount > accountFrom.balance) {
            return  res.status(402).send({error: 'Insufficient funds'})
        }

        //Get accountTo bank prefix
        const bankToPrefix = req.body.accountTo.slice(0, 3)
        let bankTo = await Bank.findOne({bankPrefix: bankToPrefix})

        if(!bankTo){

            // Refresh the list of banks from central bank
            const result = await refreshListOfBanksFromCentralBank()
            console.log(result)

            if (typeof result.error !== 'undefined') {
                console.log('There was an error communicating with central bank:')
                console.log(result.error)
                statusDetail = result.error
            } else {

                // Try again after refresh
                let bankTo = await Bank.findOne({bankPrefix: bankToPrefix})

                if(!bankTo){
                    return res.status(400).json({error: 'Invalid destination bank'})
                }
            }
        } else {
            console.log('Bank was cashed')
        }

        //add transaction to DB
        await new Transaction({
            userId: req.userId,
            amount: req.body.amount,
            currency: accountFrom.currency,
            accountTo: req.body.accountTo,
            accountFrom: req.body.accountFrom,
            explanation: req.body.explanation,
            statusDetail: statusDetail,
            senderName: (await User.findOne({id: req.userId})).name,

        }).save()

        // subtract amount from account
        debitAccount(accountFrom, req.body.amount);

        //created
        return res.status(201).end()

    } catch (e) {

        // 400 invalid amount
        if(/.*Cast to Number for value .*amount/.test(e.message)
        || /Transaction validation failed: amount.*/.test(e.message)){
            return res.status(400).send('Invalid amount')
        }

        // 400 Bad request
        if(/Transaction validation failed: .+/.test(e.message)){
            return res.status(400).send({error: e.message})
        }


        // 500 internal server error
        console.log(e.message)
        return res.status(500).end()
    }
})

router.get('/jwks', async function(req, res){

        // Create new keystore
        const keystore = jose.JWK.createKeyStore();

        // Add our private key from file to the keystore
        await keystore.add(fs.readFileSync('./private.key').toString(), 'pem')

        // Return our keystore (only the public key derived from the imported private key) in JWKS (JSON Web Key Set) format
        console.log('/jwks: Exporting keystore and returning it')
        return res.send(keystore.toJSON())

    })

    router.post('/b2b', async function (req, res) {

        try {
            const components = req.body.jwt.split('.')

            const payload = JSON.parse(base64url.decode(components[1]))


            const accountTo = await Account.findOne({number: payload.accountTo})

            if (!accountTo) {
                return res.status(404).send({error: 'Account not found'})
            }

            const accountFromBankPrefix = payload.accountFrom.substring(0, 3)

            const accountFromBank = await Bank.findOne({bankPrefix: accountFromBankPrefix})
            if (!accountFromBank) {
                const result = await refreshListOfBanksFromCentralBank();
                if (typeof result.error !== 'undefined') {
                    return res.status(502).send({error: "There was an error communication with Central Bank" + result.error});
                }
                const accountFromBank = await Bank.findOne({bankPrefix: accountFromBankPrefix})

                if (!accountFromBank) {
                    return res.status(404).send({error: 'Bank ' + accountFromBankPrefix + ' was not found in Central Bank'})
                }
            }


            // Validate signature




            let amount = payload.amount

            // change currency
            if (accountTo.currency !== payload.currency) {
                const rate = await getRates(payload.currency, accountTo.currency)
                amount = parseInt((parseInt(amount) * parseFloat(rate)).toFixed(0))
            }

            const accountToOwner = await User.findOne({_id: accountTo.userId})
            accountTo.balance += amount
            accountTo.save();

            await Transaction.create({
                userId: accountToOwner._id,
                accountFrom: payload.accountFrom,
                accountTo: payload.accountTo,
                amount: payload.amount,
                currency: payload.currency,
                createdAt: payload.createdAt,
                explanation: payload.explanation,
                senderName: payload.senderName,
                receiverName: accountToOwner.name,
                status: 'Completed',
                statusDetail: 'Received'
            })

            res.send({receiverName: accountToOwner.name})
        } catch (e) {
            return res.status(500).send({error: e.message})
        }
    })

    async function getRates(from, to) {
        const response = await axios.get('https://api.exchangerate.host/latest?base=' + from)
        console.log(`Converting ${from} to ${to}`)
        for (const rate in response.data.rates) {
            if (rate === to) {
                console.log(`Rate is: ${response.data.rates[rate]}`)
                return response.data.rates[rate]
            }
        }
    }

    router.get('/', verifyToken, async (req, res) => {

        //Get user's transactions
        const transactions = await Transaction.find({userId: req.userId})

        // Return them
        res.status(200).json(transactions)
    })
module.exports = router