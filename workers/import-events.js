'use strict';

const request = require('request-promise');
const redis = require('redis').createClient();

const NBAPIKey = 'e2e9cdeb3f70012949c6e90dc69b028d739846f8dad45ceee44e4e78d22c0533';
const NBNationSlug = 'plp';
const NBSiteSlug = 'plp';

var initUrl = `https://${NBNationSlug}.nationbuilder.com/api/v1/sites/${NBSiteSlug}/pages/events?limit=100&access_token=${NBAPIKey}`;

/**
 * Fetch next page of events
 * @param  {string} nextPage The URL of the next page.
 */
function fetchPage(nextPage) {
  request({
    url: nextPage,
    headers: {Accept: 'application/json'},
    json: true,
    resolveWithFullResponse: true
  })
  .then(function(res) {
    console.log(`Fetched ${nextPage}`);
    res.body.results.forEach(result => {
      var resource = result.calendar_id === 3 ? 'groups' : 'events';

      var body = {
        id: result.id,
        name: result.name,
        slug: result.slug,
        path: result.path,
        published: (result.status.indexOf('publiée') !== -1)
      };

      if (result.status.indexOf('publiée') === -1) {
        return;
      }

      if (result.venue && result.venue.address && result.venue.address.lng &&
      result.venue.address.lat) {
        body.coordinates = {
          type: 'Point',
          coordinates: [
            Number(result.venue.address.lng),
            Number(result.venue.address.lat)
          ]
        };
      }

      if (result.calendar_id !== 3) {
        body.startTime = new Date(result.start_time).toUTCString();
        switch (result.calendar_id) {
          case 4:
            body.agenda = 'evenements_locaux';
            break;
          case 7:
            body.agenda = 'melenchon';
            break;
        }
      }

      request.get({
        url: `http://localhost:5000/${resource}/${result.id}`,
        json: true,
        resolveWithFullResponse: true
      }).then(res => {
        body._id = res.body._id;

        try {
          require('assert').deepEqual(body, res.body);
        } catch (e) {
          return request.put({
            url: `http://localhost:5000/${resource}/${res.body._id}`,
            body: body,
            headers: {
              'If-Match': res.body._etag
            },
            json: true
          });
        }
      }, err => {
        if (err.statusCode === 404) {
          return request.post({
            url: `http://localhost:5000/${resource}`,
            body: body,
            json: true
          });
        }

        throw err;
      });
    });

    var next = res.body.next ?
      `https://${NBNationSlug}.nationbuilder.com${res.body.next}&access_token=${NBAPIKey}` :
      initUrl;

    redis.set('import-events-next-page', next);

    var time;
    time = res.headers['Nation-Ratelimit-Reset'] * 1000 - new Date().getTime();
    time /= res.headers['Nation-Ratelimit-Remaining'];
    setTimeout(() => {
      fetchPage(next);
    }, 10000);
  })
  .catch(err => {
    // TODO
    console.log(err);
    // Crawling failed...
  });
}

redis.get('import-events-next-page', (err, reply) => {
  if (err) console.log(err);

  fetchPage(reply || initUrl);
});