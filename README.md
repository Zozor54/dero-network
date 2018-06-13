# Dero Network Status

[http://stats.atlantis.dero.live/](http://stats.atlantis.dero.live/)

## Prerequisites

### You will find

* node-project : node side project
* apps.js : Entry of Server side & client side
* public : all the website file

### Server Side

* NodeJS
* NPM
* MongoDB

#### Configuration

You need configure apps.js ; edit this file :
```javascript
const API_KEY = ‘c3295d20321531f9207bbc435f04971c’; // This API is used to geolocate nodes during their first connection. 
const SERVER_PORT = 8080; // Port for express
```

and config.json for security check :

```javascript
{
	"security": {
		"time_check": 30, // Time between every check security -- in minutes
		"topoheight": 8,
		"hash": "59521f49fbdd2c6a3cdaaff8c287ce408b0e437dbd622e1381640014fdcb9c78",
		"nonce": 2302413880
	},
	"nodes": {
		"refresh_time": 900 // Time between every daemon request -- in milliseconds
	}
}
```

### Node Side

#### Configuration

Edit node-side.js and change : 
```javascript
const serverURL = 'http://54.37.72.72:8080/nodes'; // You need to change IP and PORT. You need to set same port like server side
```


### Compile nodes-side 

```
npm install pkg
pkg ./PATH/TO/node-side.js
You will find 3 compiled file : Windows, Linux and MacOS. If your system is 64 bits this compiled files will be for it.
```

### Configuring for SSL Using Nginx

I use Nginx to proxy http(s) connections to the backend, while keeping nodes communicating with the backend on its own port, assumed here 8080

Make sure main Nodejs script is not on port 80 or 443, here we assume it’s on port 8080
Replace test.supportdero.com by intended domain name

In nginx you can have space seperated list (server_name test.supportdero.com test2.supportdero.com;)
In cert bot similarly (sudo certbot --nginx -d test.supportdero.com -d test2.supportdero.com)

#### Install and configure nginx

```
sudo apt install nginx
sudo nano /etc/nginx/sites-available/default
Use the below as config
```

```
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    root /var/www/html;
    server_name test.supportdero.com;
    location / {
            proxy_pass http://127.0.0.1:8080;
	}
```

#### Install certbot

```
sudo add-apt-repository ppa:certbot/certbot
sudo apt-get update
sudo apt-get install python-certbot-nginx
sudo certbot --nginx -d test.supportdero.com
```

Follow instructions and allow redirects, it will add SSL section to nginx config and force SSL redirects

Now to test and apply:

`sudo nginx -t` 

If successful, proceed to reload nginx :  `sudo service nginx reload`

#### Notes on multiple domain names

In nginx you can have space seperated list (server_name test.supportdero.com test2.supportdero.com;)
In cert bot similarly (sudo certbot --nginx -d test.supportdero.com -d test2.supportdero.com)

#### Note on certificate renew

Let’s Encrypt’s certificates are only valid for ninety days. This is to encourage users to automate their certificate renewal process. The certbot package we installed takes care of this for us by running ‘certbot renew’ twice a day via a systemd timer. On non-systemd distributions this functionality is provided by a script placed in /etc/cron.d. This task runs twice a day and will renew any certificate that’s within thirty days of expiration.



## Credits

* Thanks to [Mojo](https://github.com/Mojo-LB/) for your help and for the nginx configuration
* Created by [Zoz](https://github.com/Zozor54)
