'use strict';

const AWS = require('aws-sdk');
let s3 = new AWS.S3();

let bucketName = 'lambda-function-records';
let bucketParams = { Bucket: bucketName };

let limitNumberOfFileToUpdateInOneRun = 2;

exports.handler = (request, context, callback) => {
    update(request.state, request.secrets, callback);
};

async function update(state, secrets, callback) {
    let response = initializeResponse(state);

    let modifiedFiles = [];

    let listObjectsPromise = s3.listObjects(bucketParams).promise();

    listObjectsPromise.then(result => {
        for (let index = 0; index < result.Contents.length; index++) {
            
            // Only JSON files to be processed
            // We can add some pattern
            if (!result.Contents[index].Key.endsWith(".json") || Date.parse(result.Contents[index].LastModified) <= Date.parse(state.since)) {
                continue;
            }

            modifiedFiles.push(result.Contents[index]);
            
            // If we want to process limited number of files in one lambda execution, so we should only add those number of files
            if (modifiedFiles.length === limitNumberOfFileToUpdateInOneRun) {
                response.hasMore = true;
                break;
            }
        }
    }).catch(err => {
        callback(err); // Return when some error occurred while listing objects in bucket
        console.log("Error in listing bucket", JSON.stringify(err) + "\n");
    });

    // Waiting for listing of objects so we can get all modified files
    await listObjectsPromise;

    // Sort in ascending order
    modifiedFiles.sort((a, b) => { return (a.LastModified > b.LastModified) ? 1 : ((b.LastModified > a.LastModified) ? -1 : 0); });

    // Process files one by one
    for (let index = 0; index < modifiedFiles.length; index++) {
        let modifiedFile = modifiedFiles[index];

        let params = {
            Bucket: bucketName,
            Key: modifiedFile.Key
        };

        let getObjectPromise = s3.getObject(params).promise();

        getObjectPromise.then(result => {
            let fileData = JSON.parse(result.Body.toString('utf-8'));

            if (modifiedFile.Key.endsWith("_delete.json")) {
                for (let deleteIndex = 0; deleteIndex < fileData.deletes.length; deleteIndex++) {
                    let r = fileData.deletes[deleteIndex];
                    response.delete.near_earth_objects.push(r);
                }
            } else {
                let keys = Object.keys(fileData.near_earth_objects);

                for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {

                    let key = keys[keyIndex];

                    for (let valueIndex = 0; valueIndex < fileData.near_earth_objects[key].length; valueIndex++) {
                        let r = fileData.near_earth_objects[key][valueIndex];
                        r['date'] = key;
                        response.insert.near_earth_objects.push(r);
                    }
                }
            }


        }).catch(err => {
            callback(err); // Return when some error occurred while reading any file
            console.log("Error in getting object : " + err + "\n");
        });

        await getObjectPromise;

        // Same last modified of processed file so we process files after that in next run
        response.state.since = modifiedFile.LastModified;
    }

    // Once response in generated use callback to finish lambda execution with response
    callback(null, response);
}

function initializeResponse(state) {
    // Don't assign the value directly, it means you are assigning as a reference, 
    // Now state of response doesn't get affected when change state variable in method
    return {
        "state": {...state}, 
        "insert": {
            "near_earth_objects": []
        },
        "delete": {
            "near_earth_objects": []
        },
        "schema": {
            "near_earth_objects": {
                "primary_key": ["neo_reference_id"]
            }
        },
        hasMore: false
    };
}