// Include the cluster module
const cluster = require('cluster');

// Code to run if we're in the master process
if (cluster.isMaster) {
  // Count the machine's CPUs
  let cpuCount = require('os').cpus().length;

  // Create a worker for each CPU
  for (let i = 0; i < cpuCount; i += 1) {
    cluster.fork();
  }

  // Listen for terminating workers
  cluster.on('exit', function (worker) {
    // Replace the terminated workers
    console.log('Worker ' + worker.id + ' died :(');
    cluster.fork();
  });

// Code to run if we're in a worker process
} else {
  const AWS = require('aws-sdk');
  const express = require('express');
  const bodyParser = require('body-parser');
  const cors = require('cors');
  const dotenv = require('dotenv');
  const mapDinamoResponse = require('./functions/mapDinamoResponse');

  // making .env vars readable
  dotenv.config();

  AWS.config.region = process.env.REGION;
  AWS.config.credentials = {};
  AWS.config.credentials.accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  AWS.config.credentials.secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  const sns = new AWS.SNS();
  const ddb = new AWS.DynamoDB();

  const ddbTable =  process.env.STARTUP_SIGNUP_TABLE;
  const snsTopic =  process.env.NEW_SIGNUP_TOPIC;
  const environment = process.env.ENVIRONMENT || 'develop';

  // db tables
  const devicesTableName = 'CarbonoDetector-Devices';
  const measuresTableName = 'CarbonoDetector-Measures';

  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', __dirname + '/views');

  app.use(cors());
  app.use(bodyParser.urlencoded({ extended: false }));
  app.use(bodyParser.json());
  app.use(express.static(__dirname + '/static'));

  /**
   * Views
   */
  app.get('/', function(_, res) {
    res.render('index', {
      static_path: environment === 'develop' ? '' : 'static',
      theme: process.env.THEME || 'flatly',
      flask_debug: process.env.FLASK_DEBUG || 'false'
    });
  });

  app.get('/devices-view', async (_, res) => {
    let devices = [];

    ddb.scan({ TableName: devicesTableName, Select: 'ALL_ATTRIBUTES' }, (err, data) => {
      if (!err) {
        devices = data.Items.map(device => mapDinamoResponse(device));
      } else {
        console.log('ddbError: ', err);
      }

      res.render('devices', {
        static_path: environment === 'develop' ? '' : 'static',
        theme: process.env.THEME || 'flatly',
        flask_debug: process.env.FLASK_DEBUG || 'false',
        devices
      });
    });
  });

  app.get('/measures-view/:serialNumber', (req, res) => {
    const serialNumber = req.params.serialNumber;

    ddb.query({
      TableName : measuresTableName,
      KeyConditionExpression: '#sn = :snvalue',
      ExpressionAttributeNames:{
        "#sn": "serialNumber"
      },
      ExpressionAttributeValues: {
        ':snvalue': {
          'S': serialNumber
        }
      }
    }, (err, data) => {
      if (err) {
        console.log('ddbError: ', err);
        res.status(500).end();
      } else {
        res.render('measures', {
          static_path: environment === 'develop' ? '' : `${req.protocol}://${req.get('host')}/static`,
          theme: process.env.THEME || 'flatly',
          flask_debug: process.env.FLASK_DEBUG || 'false',
          measures: data.Items.map(item => mapDinamoResponse(item)) || []
        });
      }
    });
  });

  /**
   * Users API
   */
  app.post('/signup', function(req, res) {
    const item = {
      'email': { 'S': req.body.email },
      'name': { 'S': req.body.name },
      'preview': { 'S': req.body.previewAccess },
      'theme': { 'S': req.body.theme }
    };

    ddb.putItem({
      'TableName': ddbTable,
      'Item': item,
      'Expected': { email: { Exists: false } }
    }, function(err) {
      if (err) {
        let returnStatus = 500;

        if (err.code === 'ConditionalCheckFailedException') {
          returnStatus = 409;
        }

        res.status(returnStatus).end();
        console.log('DDB Error: ' + err);
      } else {
        sns.publish({
          'Message':
            'Name: ' + req.body.name +
            "\r\nEmail: " + req.body.email +
            "\r\nPreviewAccess: " + req.body.previewAccess +
            "\r\nTheme: " + req.body.theme,
          'Subject': 'New user sign up!!!',
          'TopicArn': snsTopic
        }, function(err) {
          if (err) {
            res.status(500).end();
            console.log('SNS Error: ' + err);
          } else {
            res.status(201).end();
          }
        });
      }
    });
  });

  /**
   *  Devices API
   */
  app.post('/devices', (req, res) => {
    const device = {
      'serialNumber': { 'S': req.body.serialNumber },
      'client': { 'S': req.body.client },
      'branchOffice': { 'S': req.body.branchOffice },
      'section': { 'S': req.body.section }
    };

    ddb.putItem({
      'TableName': devicesTableName,
      'Item': device,
      'Expected': { serialNumber: { Exists: false } }
    }, err => {
      if (err) {
        console.log('ddbError: ', err);
        err.code === 'ConditionalCheckFailedException' ? res.status(409).end() : res.status(500).end();
      } else {
        res.status(201).json(device).end();
      }
    });
  });

  /**
   * Measures API
   */
  app.post('/measures', (req, res) => {
    const measure = {
      'serialNumber': { 'S': req.body.serialNumber },
      'timeStamp': { 'N': Date.now().toString() },
      'HUM': { 'N': req.body.HUM.toString() },
      'PPM': { 'N': req.body.PPM.toString() },
      'TEMP': { 'N': req.body.TEMP.toString() },
    };

    ddb.putItem({
      'TableName': measuresTableName,
      'Item': measure
    }, err => {
      if (err) {
        console.log('ddbError: ', err);
        res.status(500).end();
      } else {
        res.status(201).json(measure).end();
      }
    });
  });

  app.get('/measures/:serialNumber', (req, res) => {
    const serialNumber = req.params.serialNumber;

    ddb.query({
      TableName : measuresTableName,
      KeyConditionExpression: '#sn = :snvalue',
      ExpressionAttributeNames:{
        "#sn": "serialNumber"
      },
      ExpressionAttributeValues: {
        ':snvalue': {
          'S': serialNumber
        }
      }
    }, (err, data) => {
      if (err) {
        console.log('ddbError: ', err);
        res.status(500).end();
      } else {
        res.status(200).json({
          count: data.Count,
          items: data.Items.map(item => mapDinamoResponse(item))
        }).end();
      }
    });
  });

  const port = process.env.PORT || 3000;
  const server = app.listen(port, function () {
    console.log('Server running at http://127.0.0.1:' + port + '/');
  });
}