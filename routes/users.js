const router = require('express').Router();
const User = require('../models/User')
const Account = require('../models/Account')
const bcrypt = require('bcrypt')
const {verifyToken} = require("../middlewares");


router.post('/', async (req, res) => {

    // Make sure the password is typed
    if (typeof req.body.password === "undefined" || req.body.password.length < 8) {
        res.status(400).send({error: "Invalid password."})
        return
    }
    req.body.password = await bcrypt.hash(req.body.password, 10);

    try {
        const user = await new User(req.body).save()
        await new Account({userId: user.id}).save()

        res.status(201).send(' ')
    } catch (e) {
        // Catch duplicate username attempts
        if (/E11000.*username.* dup key.*/.test(e.message)) {
            res.status(409).send({error: 'Username already exists!'})
            return
        }
        if (/User validation failed: .*: Path `.*` is required/.test(e.message)) {
            return res.status(400).send({error: e.message})
        }

        // Catch server error
        return res.status(500).send({error: e.message})

    }

});

router.get('/current',verifyToken, async (req, res) => {

    //Get user object from DB
    const user = await User.findOne({_id: req.userId});

    //Get user`s accounts
    const accounts = await Account.find({userId: req.userId});

    res.status(200).send( {
        id: user.id,
        name: user.name,
        username: user.username,
        accounts: accounts
    })
});
module.exports = router