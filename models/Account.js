const mongoose = require("mongoose");
require('dotenv').config()


module.exports = mongoose.model('Account', mongoose.Schema({
    name: {type: String, required: true, min: 2, max: 255, default: 'Main'},
    number: {
        type: String,
        required: true,
        min: 11,
        default: function () {
            return process.env.BANK_PREFIX + require('md5')(new Date().toISOString())
        }
    },
    userId: {type: mongoose.Schema.Types.ObjectId, ref: 'User'},
    balance: {type: Number, required: true, min: 0, default: 5000},
    currency: {type: String, required: true, default: 'EUR'}
},{
    toJSON: {
        transform: (docIn, docOut) => {
            docOut.id = docOut._id
            delete docOut._id
            delete docOut.__v
        }
    }
}))