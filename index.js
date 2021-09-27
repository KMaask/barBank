const express = require('express');
const app = express();
const mongoose = require('mongoose')
const swaggerUi = require('swagger-ui-express')
const yaml = require('yamljs')
const swaggerDocument = yaml.load('docs/swagger.yaml')
require('dotenv').config()

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument))
app.use(express.json())

//endpoints
app.use('/users', require('./routes/users'))


mongoose.connect(process.env.MONGODB_URI, {}, function(){
    console.log('Connected to mongoDB...')
})

app.use(function(req){

})

app.listen(process.env.PORT, () => {
    console.log('listening on http://localhost:' + process.env.PORT);
})
