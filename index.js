'use strict';

module.exports = function (ServerlessPlugin) {

    const path = require('path'),
        _ = require('lodash'),
        fs = require('fs'),
        os = require('os'),
        debug = require('debug')('ServerlessPrismic'),
        prismic = require('prismic.io'),
        BbPromise = require('bluebird'),
        writefile = require('writefile');

    /**
     * ServerlessPrismic
     */
    class ServerlessPrismic extends ServerlessPlugin {

        constructor(S) {
            super(S);
        }

        static getName() {
            return 'nz.geek.findlay.' + ServerlessPrismic.name;
        }

        registerHooks() {

            this.S.addHook(this._prismic.bind(this), {
                action: 'functionRunLambdaNodeJs',
                event: 'pre'
            });

            return BbPromise.resolve();
        }

        _prismic(evt) {

            // Get function
            let func = this.S.state.getFunctions({  paths: [evt.options.path] })[0],
                component = func.getComponent(),
                prismicNodejs;

            // Skip if not set on component OR function
            if ((!component.custom || !component.custom.prismic) && (!func.custom || !func.custom.prismic)) {
                return BbPromise.resolve(evt);
            }

            // If set in component, but false in function, skip
            if (component.custom && component.custom.prismic && func.custom && func.custom.prismic === false) {
                return BbPromise.resolve(evt);
            }

            // Prismic: Nodejs
            if (component.runtime === 'nodejs') {
                prismicNodejs = new PrismicNodejs(this.S, evt, component, func);
                return prismicNodejs.download()
                    .then(function (evt) {
                        return evt;
                    });
            }

            // Otherwise, skip plugin
            return BbPromise.resolve(evt);
        }
    }

    class PrismicNodejs {

        constructor(S, evt, component, func) {
            this.S = S;
            this.evt = evt;
            this.component = component;
            this.function = func;
        }

        download() {

            let _this = this;

            _this.config = {
                repo: "",
                api_key: null,
                queries: [],
                base: fs.realpathSync(_this.component._config.fullPath)
            };
            _this.config = _.merge(
                _this.config,
                _this.component.custom.prismic ? _this.component.custom.prismic === true ? {} : _this.component.custom.prismic : {},
                _this.function.custom.prismic ? _this.function.custom.prismic === true ? {} : _this.function.custom.prismic : {}
            );
            return BbPromise.resolve(_this.config)
                .then(this.connect)
                .spread(this.query)
                .each(this.save)
                .then(function () {
                    return _this.evt
                });
        }

        connect(config) {
            return new BbPromise(function (resolve, reject) {
                prismic.Prismic.Api(config.repo, function (err, Api) {
                    if (err) {
                        reject(err);
                    } else {
                        debug("Connected");
                        resolve([config, Api]);
                    }
                }, config.api_key);
            });
        }

        query(config, Api) {
            return BbPromise.map(config.queries, function (query) {
                return new BbPromise(function (resolve, reject) {
                    Api.form('everything')
                        .ref(Api.master())
                        .query(query.query)
                        .orderings(query.sort ? query.sort : null)
                        .submit(function (err, response) {
                            if (err) reject(err); else {
                                debug(query);
                                debug("Query results :" + JSON.stringify(response.results_size));
                                resolve([config, response.results, query]);
                            }
                        });
                });
            });
        }

        save() {
            let config = arguments[0][0],
                results = arguments[0][1], query = arguments[0][2];
            let name = new Function('result', query.resolver);
            let output = {};
            for (var result in results) {
                output[results[result].uid] = results[result].data;
            }
            debug("Writing out " + path.join(config.base, name(results)));
            return writefile(path.join(config.base, name(results)), JSON.stringify(output));
            // TODO collections
            //let writers = [];
            //for (var result in results) {
            //    writers[result] = writefile(path.join(config.base, name(results[result])), JSON.stringify(results[result]), 'utf8');
            //}
            //return BbPromise.all(writers);
        }
    }

    return ServerlessPrismic
};

