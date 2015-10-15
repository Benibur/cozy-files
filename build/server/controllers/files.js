// Generated by CoffeeScript 1.10.0
var File, Folder, async, baseController, confirmCanUpload, cozydb, crypto, feed, folderParent, fs, getFileClass, isStorageError, log, mime, moment, multiparty, normalizePath, pathHelpers, ref, resetTimeout, sendBinary, sharing, timeout, updateParents;

fs = require('fs');

async = require('async');

moment = require('moment');

crypto = require('crypto');

multiparty = require('multiparty');

mime = require('mime');

log = require('printit')({
  prefix: 'files'
});

cozydb = require('cozydb');

File = require('../models/file');

Folder = require('../models/folder');

feed = require('../lib/feed');

sharing = require('../helpers/sharing');

pathHelpers = require('../helpers/path');

ref = require('../helpers/file'), normalizePath = ref.normalizePath, getFileClass = ref.getFileClass;

baseController = new cozydb.SimpleController({
  model: File,
  reqProp: 'file',
  reqParamID: 'fileid'
});

module.exports.destroyBroken = function(req, res) {
  return res.send(400, {
    error: true,
    msg: "Deletion error for tests"
  });
};

module.exports.fetch = function(req, res, next, id) {
  return File.request('all', {
    key: id
  }, function(err, file) {
    if (err || !file || file.length === 0) {
      if (err == null) {
        err = new Error('File not found');
        err.status = 404;
        err.template = {
          name: '404',
          params: {
            localization: require('../lib/localization_manager'),
            isPublic: req.url.indexOf('public') !== -1
          }
        };
      }
      return next(err);
    } else {
      req.file = file[0];
      return next();
    }
  });
};

module.exports.find = baseController.send;

module.exports.all = baseController.listAll;

sendBinary = baseController.sendBinary({
  filename: 'file'
});

module.exports.getAttachment = function(req, res, next) {
  var encodedFileName, isDownloading, keepAlive;
  isDownloading = true;
  (keepAlive = function() {
    if (isDownloading) {
      feed.publish('usage.application', 'files');
      return setTimeout(keepAlive, 60 * 1000);
    }
  })();
  encodedFileName = encodeURIComponent(req.file.name);
  res.setHeader('Content-Disposition', "inline; filename*=UTF8''" + encodedFileName);
  res.on('close', function() {
    return isDownloading = false;
  });
  res.on('finish', function() {
    return isDownloading = false;
  });
  return sendBinary(req, res, next);
};

module.exports.downloadAttachment = function(req, res, next) {
  var encodedFileName, isDownloading, keepAlive;
  isDownloading = true;
  (keepAlive = function() {
    if (isDownloading) {
      feed.publish('usage.application', 'files');
      return setTimeout(keepAlive, 60 * 1000);
    }
  })();
  encodedFileName = encodeURIComponent(req.file.name);
  res.setHeader('Content-Disposition', "attachment; filename*=UTF8''" + encodedFileName);
  res.on('close', function() {
    return isDownloading = false;
  });
  res.on('finish', function() {
    return isDownloading = false;
  });
  return sendBinary(req, res, next);
};

folderParent = {};

timeout = null;

isStorageError = function(err) {
  return err.toString().indexOf('enough storage') !== -1;
};

resetTimeout = function() {
  if (timeout != null) {
    clearTimeout(timeout);
  }
  return timeout = setTimeout(updateParents, 60 * 1000);
};

updateParents = function() {
  var errors, folder, i, len, name, ref1;
  errors = {};
  ref1 = Object.keys(folderParent);
  for (i = 0, len = ref1.length; i < len; i++) {
    name = ref1[i];
    folder = folderParent[name];
    folder.save(function(err) {
      if (err != null) {
        return errors[folder.name] = err;
      }
    });
  }
  return folderParent = {};
};

confirmCanUpload = function(data, req, next) {
  var element;
  if (!req["public"]) {
    return next(null);
  }
  element = new File(data);
  return sharing.checkClearance(element, req, 'w', function(authorized, rule) {
    var err;
    if (authorized) {
      if (rule != null) {
        req.guestEmail = rule.email;
        req.guestId = rule.contactid;
      }
      return next();
    } else {
      err = new Error('You cannot access this resource');
      err.status = 404;
      err.template = {
        name: '404',
        params: {
          localization: require('../lib/localization_manager'),
          isPublic: true
        }
      };
      return next(err);
    }
  });
};

module.exports.create = function(req, res, next) {
  var fields, form;
  if (timeout != null) {
    clearTimeout(timeout);
  }
  fields = {};
  form = new multiparty.Form();
  form.on('part', function(part) {
    var attachBinary, canceled, err, fullPath, keepAlive, lastModification, name, now, overwrite, path, rollback, upload, uploadStream;
    if (part.filename == null) {
      fields[part.name] = '';
      part.on('data', function(buffer) {
        return fields[part.name] = buffer.toString();
      });
      return;
    }
    name = fields.name;
    path = fields.path;
    lastModification = moment(new Date(fields.lastModification));
    lastModification = lastModification.toISOString();
    overwrite = fields.overwrite;
    upload = true;
    canceled = false;
    uploadStream = null;
    if (!name || name === "") {
      err = new Error("Invalid arguments: no name given");
      err.status = 400;
      return next(err);
    }
    keepAlive = function() {
      if (upload) {
        feed.publish('usage.application', 'files');
        setTimeout(keepAlive, 60 * 1000);
        return resetTimeout();
      }
    };
    rollback = function(file, err) {
      canceled = true;
      return file.destroy(function(delerr) {
        if (delerr) {
          log.error(delerr);
        }
        if (isStorageError(err)) {
          return res.send({
            error: true,
            code: 'ESTORAGE',
            msg: "modal error size"
          }, 400);
        } else {
          return next(err);
        }
      });
    };
    attachBinary = function(file) {
      var checksum, metadata;
      part.path = file.name;
      checksum = crypto.createHash('sha1');
      checksum.setEncoding('hex');
      part.pause();
      part.pipe(checksum);
      metadata = {
        name: "file"
      };
      return uploadStream = file.attachBinary(part, metadata, function(err) {
        var data;
        upload = false;
        if (err) {
          return rollback(file, err);
        }
        checksum.end();
        checksum = checksum.read();
        if (!canceled) {
          data = {
            checksum: checksum,
            uploading: false
          };
          return file.updateAttributes(data, function(err) {
            if (err) {
              log.debug(err);
            }
            return file.index(["name"], function(err) {
              var who;
              if (err) {
                log.debug(err);
              }
              who = req.guestEmail || 'owner';
              return sharing.notifyChanges(who, file, function(err) {
                if (err) {
                  log.debug(err);
                }
                return File.find(file.id, function(err, file) {
                  if (err) {
                    log.debug(err);
                  }
                  return res.send(file, 200);
                });
              });
            });
          });
        }
      });
    };
    now = moment().toISOString();
    path = normalizePath(path);
    fullPath = path + "/" + name;
    return File.byFullPath({
      key: fullPath
    }, function(err, sameFiles) {
      var attributes, data, file;
      if (err) {
        return next(err);
      }
      if (sameFiles.length > 0) {
        if (overwrite) {
          file = sameFiles[0];
          attributes = {
            lastModification: lastModification,
            size: part.byteCount,
            mime: mime.lookup(name),
            "class": getFileClass(part),
            uploading: true
          };
          return file.updateAttributes(attributes, function() {
            keepAlive();
            return attachBinary(file);
          });
        } else {
          upload = false;
          return res.send({
            error: true,
            code: 'EEXISTS',
            msg: "This file already exists"
          }, 400);
        }
      }
      data = {
        name: name,
        path: normalizePath(path),
        creationDate: now,
        lastModification: lastModification,
        mime: mime.lookup(name),
        size: part.byteCount,
        tags: [],
        "class": getFileClass(part),
        uploading: true
      };
      return confirmCanUpload(data, req, function(err) {
        if (err) {
          return next(err);
        }
        return Folder.byFullPath({
          key: data.path
        }, function(err, parents) {
          var parent;
          if (err) {
            return next(err);
          }
          if (parents.length > 0) {
            parent = parents[0];
            data.tags = parent.tags;
            parent.lastModification = now;
            folderParent[parent.name] = parent;
          }
          return File.create(data, function(err, newFile) {
            if (err) {
              return next(err);
            }
            keepAlive();
            err = new Error('Request canceled by user');
            res.on('close', function() {
              log.info('Upload request closed by user');
              return uploadStream.abort();
            });
            return attachBinary(newFile);
          });
        });
      });
    });
  });
  form.on('error', function(err) {
    return log.error(err);
  });
  return form.parse(req);
};

module.exports.publicCreate = function(req, res, next) {
  req["public"] = true;
  return module.exports.create(req, res, next);
};

module.exports.modify = function(req, res, next) {
  var body, file, isPublic, newFullPath, newName, newPath, previousFullPath, previousName, previousPath, ref1, ref2, tags;
  log.info("File modification of " + req.file.name + "...");
  file = req.file;
  body = req.body;
  if (body.tags && (Array.isArray(body.tags)) && ((ref1 = file.tags) != null ? ref1.toString() : void 0) !== ((ref2 = body.tags) != null ? ref2.toString() : void 0)) {
    tags = body.tags;
    tags = tags.filter(function(tag) {
      return typeof tag === 'string';
    });
    return file.updateAttributes({
      tags: tags
    }, function(err) {
      if (err) {
        return next(new Error("Cannot change tags: " + err));
      } else {
        log.info("Tags changed for " + file.name + ": " + tags);
        return res.send({
          success: 'Tags successfully changed'
        }, 200);
      }
    });
  } else if ((!body.name || body.name === "") && (body.path == null)) {
    log.info("No arguments, no modification performed for " + req.file.name);
    return next(new Error("Invalid arguments, name should be specified."));
  } else {
    previousName = file.name;
    newName = body.name != null ? body.name : previousName;
    previousPath = file.path;
    if (req.body.path != null) {
      body.path = normalizePath(body.path);
    }
    newPath = body.path != null ? body.path : previousPath;
    isPublic = body["public"];
    newFullPath = newPath + "/" + newName;
    previousFullPath = previousPath + "/" + previousName;
    return File.byFullPath({
      key: newFullPath
    }, function(err, sameFiles) {
      var data, modificationSuccess;
      if (err) {
        return next(err);
      }
      modificationSuccess = function(err) {
        if (err) {
          log.raw(err);
        }
        log.info(("Filechanged from " + previousFullPath + " ") + ("to " + newFullPath));
        return res.send({
          success: 'File successfully modified'
        });
      };
      if (sameFiles.length > 0) {
        log.info("No modification: Name " + newName + " already exists.");
        return res.send(400, {
          error: true,
          msg: "The name is already in use."
        });
      } else {
        data = {
          name: newName,
          path: normalizePath(newPath),
          "public": isPublic
        };
        if (body.clearance) {
          data.clearance = body.clearance;
        }
        return file.updateAttributes(data, function(err) {
          if (err) {
            return next(new Error('Cannot modify file'));
          } else {
            return file.updateParentModifDate(function(err) {
              if (err) {
                log.raw(err);
              }
              return file.index(["name"], modificationSuccess);
            });
          }
        });
      }
    });
  }
};

module.exports.destroy = function(req, res, next) {
  var file;
  file = req.file;
  return file.destroyWithBinary(function(err) {
    if (err) {
      log.error("Cannot destroy document " + file.id);
      return next(err);
    } else {
      return file.updateParentModifDate(function(err) {
        if (err) {
          log.raw(err);
        }
        return res.send({
          success: 'File successfully deleted'
        });
      });
    }
  });
};

module.exports.search = function(req, res, next) {
  var parts, query, sendResults, tag;
  sendResults = function(err, files) {
    if (err) {
      return next(err);
    } else {
      return res.send(files);
    }
  };
  query = req.body.id;
  query = query.trim();
  if (query.indexOf('tag:') !== -1) {
    parts = query.split();
    parts = parts.filter(function(tag) {
      return tag.indexOf('tag:' !== -1);
    });
    tag = parts[0].split('tag:')[1];
    return File.request('byTag', {
      key: tag
    }, sendResults);
  } else {
    return File.search("*" + query + "*", sendResults);
  }
};


/**
 * Returns thumb for given file.
 * there is a bug : when the browser cancels many downloads, some are not
 * cancelled, what leads to saturate the stack of threads and blocks the
 * download of thumbs.
 * Cf comments bellow to reproduce easily
 */

module.exports.photoThumb = function(req, res, next) {
  var stream, which;
  which = req.file.binary.thumb ? 'thumb' : 'file';
  stream = req.file.getBinary(which, function(err) {
    if (err) {
      console.log(err);
      next(err);
      stream.on('data', function() {});
      stream.on('end', function() {});
      stream.resume();
    }
  });
  req.on('close', function() {
    return stream.abort();
  });
  res.on('close', function() {
    return stream.abort();
  });
  return stream.pipe(res);
};


/**
 * Returns "screens" (image reduced in ) for given file.
 * there is a bug : when the browser cancels many downloads, some are not
 * cancelled, what leads to saturate the stack of threads and blocks the
 * download of thumbs.
 * Cf comments bellow to reproduce easily
 */

module.exports.photoScreen = function(req, res, next) {
  var stream, which;
  which = req.file.binary.screen ? 'screen' : 'file';
  stream = req.file.getBinary(which, function(err) {
    if (err) {
      console.log(err);
      next(err);
      stream.on('data', function() {});
      stream.on('end', function() {});
      stream.resume();
    }
  });
  req.on('close', function() {
    return stream.abort();
  });
  res.on('close', function() {
    return stream.abort();
  });
  return stream.pipe(res);
};
