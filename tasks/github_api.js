/*!
 * grunt-github-api
 * https://github.com/assemble/grunt-github-api
 * Authored by Jeffrey Herb <https://github.com/JeffHerb>
 *
 * Copyright (c) 2013 Jeffrey Herb, contributors
 * Licensed under the MIT license.
 */

'use strict';

module.exports = function(grunt) {

    var github_api = require('./lib/utils');

    // Setup the new multi task
    grunt.registerMultiTask('github', 'Simple Script to query the github API.', function() {

        var done = this.async();
        var kindOf = grunt.util.kindOf;

        var getAPILimits = function(github_api, next) {

            // Check the rate limits only if the task is using a non oAuth access_token
            if (!github_api.options.oAuth) {

                github_api.request.add(github_api.options.connection, '/rate_limit', false, false);

                github_api.request.send(function(responseArray) {

                    var requests = github_api.data.src;
                    var rateOptions = github_api.options.rateLimit;
                    var res = responseArray.shift();
                    var data = res[1];
                    var taskRequests = 0;
                    var RLRemainingLimit = data[0].rate.remaining;
                    var RLReset = data[0].rate.reset;

                    // Determine how many request will be used in the current request.
                    if (kindOf(requests) === 'array') {
                        taskRequests = requests.length;
                    } else {
                        taskRequests = 1;
                    }

                    // Clean up reset date
                    RLReset = grunt.template.date((RLReset * 1000), 'h:MM:ss TT');

                    // Check to see if the API is close or about to run out
                    if (RLRemainingLimit < taskRequests) {

                        console.log('You do not have enough public API request remaining to complete this task. Skipping this task.');

                        next(github_api, true);

                    } else {

                        if (RLRemainingLimit === 0) {

                        } else {

                            if (RLRemainingLimit <= rateOptions.warning) {

                                console.log('You are about to hit your public API request limit. To avoid this issue it is suggested that you add an oAuth access token if possible. Public API limit reset at: ' + RLRemainingLimit);

                                next(github_api);
                            } else {
                                // Nothing to worry about... This time!
                                next(github_api);
                            }
                        }
                    }
                });

            } else {

                next(github_api);
            }

        };

        var generateRequest = function(github_api, next) {

            function processPaths(src, dest, options, cb) {

                // Clean up the src
                src = github_api.path.cleaner(src, true, false);

                // Clean up the dest
                if (dest) {
                    dest = github_api.path.cleaner(dest, false, false);
                } else {
                    dest = github_api.path.cleaner(src, false, false);
                }

                // Add output path if it exists.
                if (options.output.path) {
                    dest = options.output.path + '/' + dest;
                }

                // Create src parameters
                if (options.filters || options.oAuth) {
                    src += "?" + github_api.path.parameters(options.filters, options.oAuth);
                }

                github_api.request.add(options.connection, src, dest, options.task);

                if (cb) {
                    cb();
                }

            }

            var data = github_api.data;
            var options = github_api.options;

            // Only execute if source exists
            if (data.src) {

                if (kindOf(data.src) === 'array') {

                    (function multiSrc(dataSrc) {

                        var curSrc = dataSrc.shift();

                        processPaths(curSrc, data.dest || false, options, function() {

                            if (dataSrc.length === 0) {

                                next(github_api);
                            } else {

                                multiSrc(dataSrc);
                            }

                        });

                    })(data.src);

                } else {

                    processPaths(data.src, data.dest || false, options, function() {

                        next(github_api);

                    });

                }

            } else {

                next(github_api);
            }

        };

        var processRequest = function(github_api, next) {

            github_api.request.send(function(responseArray) {

                (function nextResponse(responseArray) {

                    function leaveLoop() {

                        if (responseArray.length === 0) {

                            next(github_api);
                        } else {

                            nextResponse(responseArray);
                        }

                    }

                    function checkCache(data, dest, task, cb) {

                        var destPath = dest.split('.')[0];
                        var name = task.name;
                        var uniqueId = '';

                        if (task.type === 'file') {

                            uniqueId = data[0].sha;

                        } else {

                            var jStr = JSON.stringify(data);

                            // Deal with the strange changing gravatar url that breaks cache.
                            jStr = jStr.replace(/https:\/\/\d\.gravatar/g, 'https://gravatar');

                            uniqueId = github_api.cache.generateId(jStr);

                        }

                        var cache = github_api.cache.get(name, destPath);

                        if (cache) {

                            if (uniqueId === cache.uniqueId) {

                                grunt.log.writeln(destPath + ' is already up-to-date. (No data has been written)');

                                cb(false);

                            } else {

                                github_api.cache.set(name, destPath, task.type, uniqueId);

                                cb(true);

                            }

                        } else {

                            github_api.cache.set(name, destPath, task.type, uniqueId);

                            cb(true);
                        }

                    }

                    var res = responseArray.shift(),
                        dest = res[0],
                        data = res[1],
                        task = res[2];

                    if (data.length === 1) {

                        if (task.cache) {

                            checkCache(data, dest, task, function(results) {

                                if (results) {
                                    github_api.write.add(data, dest, task.type);
                                }

                                leaveLoop();

                            });

                        } else {

                            github_api.write.add(data, dest, task.type);

                            leaveLoop();

                        }

                    } else {

                        (function collectData(data, type, collection, pos, cb) {

                            if (type === 'file') {

                                console.log('Files can not merge at this time with this plugin');

                                cb();

                            } else {

                                collection[pos] = data.shift();

                                if (data.length === 0) {

                                    if (task.cache) {

                                        checkCache(data, dest, task, function(results) {

                                            if (results) {

                                                github_api.write.add(collection, dest, task.type);

                                            }

                                            cb();

                                        });

                                    } else {

                                        github_api.write.add(collection, dest, task.type);

                                        cb();

                                    }

                                } else {

                                    collectData(data, type, collection, pos++, cb);

                                }

                            }

                        })(data, task.type, {}, 0, function() {

                            leaveLoop();

                        });

                    }

                })(responseArray);

            });
        };

        var writeResponse = function(github_api, next) {

            github_api.write.save(function() {

                next(github_api);
            });

        };

        var updateCache = function(github_api, next) {

            // Check to see if the cache status is true. If so we need to
            // Generate one more write.

            if (github_api.cache.status()) {

                var cacheData = github_api.cache.dump();

                github_api.write.write(cacheData.contents, cacheData.location, 'data', function() {

                    github_api.cache.saved();

                    grunt.log.writeln('Updated Cache!');

                    next(github_api);
                });

                //next(github_api);

            } else {

                next(github_api);
            }
        };

        var process = github_api.init(this, grunt)
          .step(getAPILimits)
          .step(generateRequest)
          .step(processRequest)
          .step(writeResponse)
          .step(updateCache)
          .execute(function(err, results) {

              if (err) {
                  console.log(err);
                  done(false);
              }

              done();

          });

    });

};