var chat = document.getElementById('chat'),
	chatContainer = document.getElementById('chat-container'),
	scrollDistance = 0, // How many pixels are we currently still hiding?
	scrollReference = 0, // Distance when we started scrolling
	imageExtensions = ['.jpg', '.jpeg', '.gif', '.png', '.webp', '.av1'],
	roomstate = {},
	bitLevels = [ 10000, 1000, 500, 100, 1 ],
	frames = 0,
	fpsInterval,
	lastFrameReset;


/** Store settings with a local cache. Storing these variables directly in localStorage would remove the variable's type information **/
var Settings = function() {
	var transparentBackgroundKeys = ['notice-color', 'highlight-color', 'channel-color'];
	// Clone default settings so they can be used to reset
	var settings = Object.assign({}, defaultSettings);
	// Restore previous settings
	var previousSettings = localStorage.getItem('config') !== null ? JSON.parse(localStorage.getItem('config')) : {};
	Object.assign(settings, previousSettings);
	// Store all settings as CSS variables as well
	Object.keys(settings).forEach((key) => document.body.style.setProperty('--' + key, settings[key]));
	transparentBackgroundKeys.forEach((key) => document.body.style.setProperty('--' + key.replace('-color', '-background-color'), settings[key] + '50'));

	var update = (key, value) => {
		settings[key] = value;
		localStorage.setItem('config', JSON.stringify(settings));
		document.body.style.setProperty('--' + key, value);
		// Generate transparent background color values
		if (transparentBackgroundKeys.indexOf(key) != -1) {
			document.body.style.setProperty(key.replace('-color', '-background-color'), value + '50');
		}
	};
	return {
		'get': (key) => settings[key],
		'set': update,
		'toggle': (key) => update(key, !settings[key]),
		'reset': () => {
			Object.assign(settings, defaultSettings);
			localStorage.setItem('config', JSON.stringify(defaultSettings));
		}
	}
}();

var highlightUsers = Settings.get('highlight-users').toLowerCase().split(',').filter((user) => user != ''),
	highlightKeyphrases = Settings.get('highlight-keyphrases').toLowerCase().split(',').filter((phrase) => phrase != '');

/** Set up chat client **/
var options = {
	connection: {
		secure: true,
		reconnect: true
	},
	channels: [ ensureHash(Settings.get('channel')) ]
};
var client = new tmi.client(options);
client.addListener('message', handleChat);
client.addListener('roomstate', handleRoomstate);
client.addListener('subscription', (channel, username, method, message, userstate) => handleSubscription(username, message, userstate));
client.addListener('resub', (channel, username, months, message, userstate, methods) => handleSubscription(username, message, userstate));
client.addListener('submysterygift', (channel, username, numbOfSubs, methods, userstate) => handleSubscription(username, null, userstate));
client.addListener('cheer', handleCheer);
client.addListener('raided', (channel, username, viewers) => addNotice(`${username} raided the channel with ${viewers} viewers!`));
client.addListener('slowmode', (channel, enabled, length) => addNotice(`Slowmode chat has been ${enabled ? 'activated' : 'deactivated'}.`));
client.addListener('followersonly', (channel, enabled, length) => addNotice(`Followers-only chat has been ${enabled ? 'activated' : 'deactivated'}.`));
client.addListener('emoteonly', (channel, enabled) => addNotice(`Emote-only chat has been ${enabled ? 'activated' : 'deactivated'}.`));
client.addListener('hosting', (channel, target, viewers) => addNotice(`The channel is now hosting ${target}.`));
client.addListener('unhost', (channel, viewers) => addNotice(`The channel has stopped hosting another channel.`));
client.addListener('messagedeleted', handleMessageDeletion);
client.addListener('ban', (channel, username, reason, userstate) => handleModAction('ban', username, null, userstate));
client.addListener('timeout', (channel, username, reason, duration, userstate) => handleModAction('timeout', username, duration, userstate));
client.addListener('clearchat', (channel) => {
	chat.textContent = '';
	addNotice('Chat has been cleared by a moderator');
});

client.connect();
updateEmbededTwitchChat();

/** Interface interactions **/
document.getElementById('settings-wheel').addEventListener('click', () => {
	document.getElementById('settings').classList.toggle('hidden');
	document.getElementById('settings').scrollTop = 0;
	document.getElementById('settings-wheel').classList.toggle('open');
});
// Twitch
document.getElementById('settings-channel').value = Settings.get('channel');
document.getElementById('settings-channel').form.addEventListener('submit', (e) => {
	var prevChannel = Settings.get('channel');
	var channel = document.getElementById('settings-channel').value;
	if (channel != prevChannel && channel != '') {
		client.leave(ensureHash(prevChannel));
		// Cross out each channel message before joining new one
		document.querySelectorAll('#chat > div').forEach(function(e) {e.style.textDecoration='line-through'});
		Settings.set('channel', channel);
		client.join(ensureHash(channel));
		resetBTTVFFZ();
		updateEmbededTwitchChat();
	}
	e.preventDefault();
});
// Style
['background-color', 'odd-background-color', 'separator-color', 'text-color', 'user-color', 'moderator-color', 'notice-color', 'highlight-color'].forEach(key => {
	document.getElementById('settings-' + key).value = Settings.get(key);
	document.getElementById('settings-' + key).addEventListener('change', (e) => Settings.set(key, e.target.value));
});
// Chat Behavior
document.body.classList.toggle('reverse-order', !Settings.get('new-messages-on-top'));
document.getElementById('settings-new-messages-on-top').checked = Settings.get('new-messages-on-top');
configureToggler('new-messages-on-top', () => {
	document.body.classList.toggle('reverse-order', !Settings.get('new-messages-on-top'));
	scrollDistance = scrollReference = 0;
	chatContainer.scrollTop = Settings.get('new-messages-on-top') ? 0 : chatContainer.scrollHeight - window.innerHeight;
});
configureToggler('smooth-scroll', () => {
	scrollDistance = scrollReference = 0;
	chatContainer.scrollTop = Settings.get('new-messages-on-top') ? 0 : chatContainer.scrollHeight - window.innerHeight;
	document.getElementById('settings-smooth-scroll').parentNode.nextElementSibling.classList.toggle('hidden', !Settings.get('smooth-scroll'));
});
if (Settings.get('smooth-scroll')) {
	document.getElementById('settings-smooth-scroll').parentNode.nextElementSibling.classList.remove('hidden');
}
document.getElementById('settings-smooth-scroll-duration').value = Settings.get('smooth-scroll-duration');
document.getElementById('settings-smooth-scroll-duration').addEventListener('input', (e) => {
	var duration = parseInt(e.target.value);
	if (!isNaN(duration) && e.target.validity.valid) {
		Settings.set('smooth-scroll-duration', duration);
	}
});

configureToggler('embed-twitch-chat', (e) => updateEmbededTwitchChat());

// Message Handling
['combine-messages-left','fade-messages-dump', 'format-urls', 'shorten-urls', 'unfurl-youtube', 'show-subscriptions', 'show-bits', 'show-mod-actions', 'external-emotes'].forEach(configureToggler);

configureToggler('combine-messages', () => document.getElementById('settings-combine-messages').parentNode.nextElementSibling.classList.toggle('hidden', !Settings.get('combine-messages')));
if (Settings.get('combine-messages')) {
	document.getElementById('settings-combine-messages').parentNode.nextElementSibling.classList.remove('hidden');
}

configureToggler('inline-images', () => document.getElementById('settings-inline-images').parentNode.nextElementSibling.classList.toggle('hidden', !Settings.get('inline-images')));
if (Settings.get('inline-images')) {
	document.getElementById('settings-inline-images').parentNode.nextElementSibling.classList.remove('hidden');
}
document.getElementById('settings-inline-images-height').value = Settings.get('inline-images-height').slice(0, -2); // remove vh identifier
document.getElementById('settings-inline-images-height').addEventListener('input', (e) => {
	var height = parseInt(e.target.value);
	if (!isNaN(height) && e.target.validity.valid) {
		Settings.set('inline-images-height', height + 'vh');
	}
});

if (Settings.get('fade-messages')) {
	document.getElementById('settings-fade-messages').parentNode.nextElementSibling.classList.remove('hidden');
}
configureToggler('fade-messages', () => document.getElementById('settings-fade-messages').parentNode.nextElementSibling.classList.toggle('hidden', !Settings.get('fade-messages')));

configureToggler('unfurl-twitter', () => {
	if (typeof twttr == 'undefined') {
		var twitterScript = document.createElement('script');
		twitterScript.src = 'https://platform.twitter.com/widgets.js';
		document.body.appendChild(twitterScript);
	}
});
if (Settings.get('unfurl-twitter')) {
	var twitterScript = document.createElement('script');
	twitterScript.src = 'https://platform.twitter.com/widgets.js';
	document.body.appendChild(twitterScript);
}
document.getElementById('settings-timestamps').value = Settings.get('timestamps');
document.getElementById('settings-timestamps').addEventListener('change', (e) => Settings.set('timestamps', e.target.value));
document.getElementById('settings-highlight-users').value = Settings.get('highlight-users');
document.getElementById('settings-highlight-users').addEventListener('input', (e) => {
	Settings.set('highlight-users', e.target.value.toLowerCase());
	highlightUsers = e.target.value.toLowerCase().split(',').filter((user) => user != '');
});
document.getElementById('settings-highlight-keyphrases').value = Settings.get('highlight-keyphrases');
document.getElementById('settings-highlight-keyphrases').addEventListener('input', (e) => {
	Settings.set('highlight-keyphrases', e.target.value.toLowerCase());
	highlightKeyphrases = e.target.value.toLowerCase().split(',').filter((phrase) => phrase != '');
});
configureToggler('show-fps', (e) => handleFPS(e.target.checked));
if (Settings.get('show-fps')) {
	handleFPS(true);
}

// Hotkeys
document.body.addEventListener('keydown', (e) => {
	if ((e.key == 'H' || e.key == 'h') && e.shiftKey && e.ctrlKey) {
		document.getElementById('curtain').classList.toggle('hidden');
	} else if ((e.key == 'S' || e.key == 's') && e.shiftKey && e.ctrlKey) {
		document.getElementById('settings').classList.toggle('hidden');
		document.getElementById('settings').scrollTop = 0;
		document.getElementById('settings-wheel').classList.toggle('open');
	} else if ((e.key == 'Escape')) {
		document.getElementById('settings').classList.add('hidden');
		document.getElementById('settings-wheel').classList.remove('open');
	}
});


// Continually scroll, in a way to make the comments readable
var lastFrame = +new Date();
function scrollUp(now) {
	if (Settings.get('show-fps')) {
		frames++;
	}
	if (Settings.get('smooth-scroll') && scrollDistance > 0) {
		// Estimate how far along we are in scrolling in the current scroll reference
		var currentStep = Settings.get('smooth-scroll-duration') / (now - lastFrame);
		scrollDistance -= scrollReference / currentStep;
		scrollDistance = Math.max(scrollDistance, 0);
		chatContainer.scrollTop = Math.round(Settings.get('new-messages-on-top') ? scrollDistance : chatContainer.scrollHeight - window.innerHeight - scrollDistance);
	}
	lastFrame = now;
	window.requestAnimationFrame(scrollUp);
}
window.requestAnimationFrame(scrollUp);


/** Chat event handling **/
let roomId;
function handleChat(channel, userstate, message, self) {
	roomId = userstate['room-id'] ? userstate['room-id'] : roomId;
	// If enabled, combine messages instead of adding a new message
	let filteredMessage = message.replace(/["\\]/g, '\\$&'); 
	let matchedMessage = document.querySelector('div[data-msg="'+filteredMessage+'"]');
	if (Settings.get('combine-messages') && matchedMessage) {
		if (!matchedMessage.counter) {
			var counterContainer = document.createElement('span'),
				counter = document.createElement('span');
			counterContainer.className = 'counter';
			if(Settings.get('combine-messages-left')) counterContainer.classList.add('float-left');
			counterContainer.appendChild(counter);
			counter.textContent = '1';
			matchedMessage.appendChild(counterContainer);
			matchedMessage.counter = counter;
		}
		chat.appendChild(matchedMessage); 
		updateEvenOddRows();
		matchedMessage.querySelector('.counter').classList.add('bump');
		matchedMessage.counter.textContent++;
		setTimeout(() => matchedMessage.querySelector('.counter').classList.remove('bump'), 150);
		return;
	}
	var chatLine = createChatLine(userstate, message);
	if (Settings.get('combine-messages')) {
		chatLine.dataset.msg = filteredMessage;
	}

	// Deal with loading user-provided inline images
	var userImages = Array.from(chatLine.querySelectorAll('img.user-image'));
	if (userImages.length > 0) {
		userImages.filter((userImage) => !userImage.complete).forEach((userImage) => {
			userImage.style.display = 'none';
			userImage.addEventListener('load', () => {
				if (userImage.dataset.mq && userImage.naturalWidth == 120) { // Failed to load, placeholder received
					if (userImage.dataset.hq) {
						userImage.src = userImage.dataset.hq;
						userImage.dataset.hq = '';
						return;
					} else if (userImage.dataset.mq) {
						userImage.src = userImage.dataset.mq;
						userImage.dataset.mq = '';
						return;
					}
				}
				var oldChatLineHeight = chatLine.scrollHeight;
				userImage.style.display = 'inline';
				scrollReference = scrollDistance += Math.max(0, chatLine.scrollHeight - oldChatLineHeight);
			});
		});
	}

	// Load Twitter messages, if any
	var tweets = Array.from(chatLine.querySelectorAll('div[data-tweet]'));
	if (tweets.length > 0 && twttr && twttr.init) {
		tweets.forEach((tweet) => {
			twttr.widgets
				.createTweet(tweet.dataset.tweet, tweet, {theme: 'dark', conversation: 'none', cards: 'hidden', dnt: 'true'})
				.then(el => {
					scrollReference = scrollDistance += el.scrollHeight;
				})
				.catch(e => console.log(e));
		});
	}
	addMessage(chatLine);
}

function handleRoomstate(channel, state) {
	if (roomstate.channel != channel) {
		addNotice(`Joined ${channel}.`);
		if (state.slow) {
			addNotice(`Channel is in slow mode.`);
		}
		if (state['followers-only'] != -1) {
			addNotice(`Channel is in followers-only mode.`);
		}
		if (state['emote-only']) {
			addNotice(`Channel is in emote-only mode.`);
		}
	}
	roomstate = state;
}

function handleSubscription(username, message, userstate) {
	if (!Settings.get('show-subscriptions')) {
		return;
	}
	var chatLine = document.createElement('div');
	chatLine.className = 'highlight';

	var subscriptionNotice = document.createElement('div');
	subscriptionNotice.textContent = userstate['system-msg'].replaceAll('\\s', ' ');
	chatLine.append(subscriptionNotice);

	if (message) {
		chatLine.append(createChatLine(userstate, message));
	}
	addMessage(chatLine);
}

function handleCheer(channel, userstate, message) {
	// We could consider to transform the cheer emotes in the message instead of removing them (https://dev.twitch.tv/docs/irc/tags/#privmsg-twitch-tags)
	var chatMessage = message;
	bitLevels.forEach((level) => chatMessage = chatMessage.replaceAll(new RegExp(`\\b[a-zA-Z]+${level}\\b`, 'g'), ''));
	var chatLine = createChatLine(userstate, chatMessage),
		cheer = document.createElement('span'),
		bitLevel = bitLevels.find((level) => parseInt(userstate.bits) >= level),
		cheerIcon = document.createElement('img');

	if (Settings.get('show-bits')) {
		if (bitLevel == undefined) {
			console.warn(`Could not parse bits received from ${userstate.username}`, userstate.bits);
			return;
		}
		cheerIcon.src = `https://static-cdn.jtvnw.net/bits/dark/animated/${bitLevel}/1.5.gif`;
		cheerIcon.alt = 'Bits';
		cheer.appendChild(cheerIcon);
		cheer.className = `cheer cheer-${bitLevel}`;
		cheer.appendChild(document.createTextNode(userstate.bits));
		chatLine.insertBefore(cheer, chatLine.lastChild);
	}
	addMessage(chatLine);
}

function handleMessageDeletion(channel, username, deletedMessage, userstate) {
	deleteMessage(document.getElementById(userstate['target-msg-id']));
}

function handleModAction(action, username, duration, userstate) {
	if (Settings.get('show-mod-actions')) {
		if (action == 'timeout') {
			addNotice(`${username} was given a time out of ${duration} second${duration == 1 ? '' : 's'}.`);
		} else if (action == 'ban') {
			addNotice(`${username} has been banned.`);
		}
	}
	Array.from(document.querySelectorAll(`#chat span[data-user="${userstate["target-user-id"]}"]`)).forEach(deleteMessage);
}

function handleFPS(enable) {
	document.getElementById('fps').innerHTML = '&nbsp;';
	document.getElementById('fps').classList.toggle('hidden', !enable);
	lastFrameReset = Date.now();
	frames = 0;
	if (enable) {
		fpsInterval = setInterval(updateFPS, 1000);
	} else {
		clearInterval(fpsInterval);
	}
}

function updateFPS() {
	var currentFrameTime = Date.now();
	document.getElementById('fps').textContent = (frames / (currentFrameTime - lastFrameReset) * 1000).toFixed(1);
	lastFrameReset = currentFrameTime;
	frames = 0;
}


/** Helper functions **/
function configureToggler(key, callback) {
	document.getElementById(`settings-${key}`).checked = Settings.get(key);
	document.getElementById(`settings-${key}`).addEventListener('click', (e) => {
		Settings.toggle(key);
		if (typeof callback === 'function') {
			callback(e);
		}
	});
}

function updateEmbededTwitchChat() {
	let tcIframe = document.getElementById('twitch-chat-embed');
	let settingsWheel = document.getElementById('settings-wheel');
	let settingsMenu = document.getElementById('settings');
	if(Settings.get('embed-twitch-chat')) {		
		tcIframe.classList.remove('hidden');
		chatContainer.classList.add('twitch-chat-embed');
		settingsWheel.classList.add('twitch-chat-embed');
		settingsMenu.classList.add('twitch-chat-embed');
		tcIframe.src = 'https://www.twitch.tv/embed/' + 
						Settings.get('channel') + 
						'/chat?parent=' + 
						document.location.host;
	} else {
		tcIframe.classList.add('hidden');
		chatContainer.classList.remove('twitch-chat-embed');
		settingsWheel.classList.remove('twitch-chat-embed');
		settingsMenu.classList.remove('twitch-chat-embed');
		return;
	}
}	

function createChatLine(userstate, message) {
	// <div><span class="chat-user moderator">$username</span><span id="$msg-id">$message</span></div>
	var chatLine = document.createElement('div'),
		chatTimestamp = document.createElement('span'),
		chatName = document.createElement('span'),
		chatMessage = document.createElement('span');

	chatName.className = 'chat-user';
	if (userstate.mod) {
		chatName.classList.add('moderator');
	}
	chatName.textContent = userstate['display-name'] || userstate.username;
	if (chatName.textContent.toLowerCase() == removeHash(Settings.get('channel')).toLowerCase()) {
		chatLine.className = 'highlight channel';
	}
	chatMessage.innerHTML = formatMessage(message, userstate.emotes);
	chatMessage.id = userstate.id;
	if (userstate['user-id']) {
		chatMessage.dataset.user = userstate['user-id'];
	}

	if (highlightUsers.indexOf(chatName.textContent.toLowerCase()) != -1) {
		chatLine.className = 'highlight';
	}
	if (highlightKeyphrases.find((phrase) => message.toLowerCase().indexOf(phrase) != -1)) {
		chatLine.className = 'highlight';
	}
	
	if (Settings.get('fade-messages') && spammyMessageCheck(chatMessage.textContent, chatName.textContent, userstate.mod)) {
		chatLine.classList.add("spammymsg");
		if(Settings.get('fade-messages-dump')) chatLine.classList.add("spammymsg-dump");
	}

	chatLine.appendChild(chatName);
	chatLine.appendChild(chatMessage);

	return chatLine;
}

const spammyBotList = ['Streamlabs', 'Nightbot', 'Moobot', 'StreamElements', 'AmazefulBot', 'Fossabot'];
const emojiRegex = new RegExp(/\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji_Presentation}|\p{Emoji}\uFE0F/gu) ; // https://mathiasbynens.be/notes/es-unicode-property-escapes#emoji
function spammyMessageCheck(message, username, isMod) {
	let filteredMsg = message
		.replace(emojiRegex,"") // Ignore emojis
		.replace(/[\udb40\udc00]/g,"") // Ignore "INVALID CHARACTER", related to emojis?
		.replace(/(\s|^)@[^\s]+/g,"") // Ignore @username
		.replace(/(\w+)([^\w]+)(\1\2){1,}(\1\2*)*/g,"$1") // Ignore repeated words
		.replace(/^![^\s]+/,"") // Ignore !command
		.replace(/(\?|\!)+$/g,"") // Ignore endingg !?
		.replace(/\s\s+/g," ") // Ignore multiple spaces
		.replace(/(^\s|\s$)/g,""); // Ignore spaces before/after

	if(filteredMsg.toUpperCase() == filteredMsg && filteredMsg.toUpperCase() != filteredMsg.toLowerCase()) return true; // Uppercase only (and upercase is different from lowercase)
	if(!filteredMsg.match(/\s/) && filteredMsg.match(/[A-Za-z]/)) return true; // No space / single word (and has a-z chars to skip asian languages)

	if(spammyBotList.includes(username)) return true; // Popular bots
	if(isMod && username.match(/bot$/i)) return true; // Channelmod with name ending with bot
	if(filteredMsg.length <3) return true; // Short/empty message
	//console.log('NOT FILTERED:' +message);
	return false;
}

function prependTimestamp(parentNode) {
	if (Settings.get('timestamps') != '') {
		let chatTimestamp = document.createElement('span');
		var formats = {
			'short24': (now) => now.toLocaleTimeString('en-GB').replace(/:\d\d$/, ''),
			'long24': (now) => now.toLocaleTimeString('en-GB'),
			'short12': (now) => now.toLocaleTimeString('en-US').replace(/:\d\d /, ' ').replace(/^(\d):/, '0$1:'),
			'long12': (now) => now.toLocaleTimeString('en-US').replace(/^(\d):/, '0$1:')
		};
		chatTimestamp.className = 'timestamp' + (Settings.get('timestamps').match(/r$/) ? ' float-right' : '');
		chatTimestamp.textContent = formats[Settings.get('timestamps').replace(/r$/, '')](new Date());
		parentNode.prepend(chatTimestamp);
	}
}
function addNotice(message) {
	var chatLine = document.createElement('div');
	chatLine.textContent = message;
	chatLine.className = 'notice';
	addMessage(chatLine);
}

function addMessage(chatLine) {
	chat.appendChild(chatLine);
	prependTimestamp(chatLine);
	chatLine.onclick = function(e) {displayMessagePopup(this, e);};
	// Calculate height for smooth scrolling
	scrollReference = scrollDistance += chatLine.scrollHeight;
	if (!Settings.get('new-messages-on-top') && !Settings.get('smooth-scroll')) {
		chatContainer.scrollTop = chatContainer.scrollHeight - window.innerHeight;
	}

	// Check whether we can remove some of the oldest messages
	while (chat.childNodes.length > 2 && chat.scrollHeight - (window.innerHeight + scrollDistance) > chat.firstChild.scrollHeight + chat.childNodes[1].scrollHeight) {
		// Always remove two elements at the same time to prevent switching the odd and even rows
		chat.firstChild.remove();
		chat.firstChild.remove();
	}
	updateEvenOddRows();
}

function deleteMessage(message) {
	if (!message || message.classList.contains('deleted')) {
		return;
	}
	message.parentNode.style.height = (message.parentNode.scrollHeight - 7) + 'px'; // 2 x 3px padding + 1px border = 7
	message.textContent = '<Message deleted>';
	message.classList.add('deleted');
}

let messagePopup = document.getElementById('msgPopup'), messagePopupContainer = document.getElementById('msgPopup-container');
messagePopupContainer.onclick= function() {this.style.display='none';};
messagePopup.onclick= function(e) {e.stopPropagation();};
function displayMessagePopup(sourceMessage, e) {
	messagePopupContainer.style.display = "block";
	messagePopup.innerHTML = sourceMessage.outerHTML;
	let maxY = window.innerHeight - messagePopup.offsetHeight;
	let maxX = window.innerWidth - messagePopup.offsetWidth;
	let messagePopupXPos = e.pageX < maxX ? e.pageX : maxX;
	let messagePopupYPos = e.pageY < maxY ? e.pageY : maxY;
	messagePopup.style.top = messagePopupYPos + 'px';
	messagePopup.style.left = messagePopupXPos + 'px';
}

/*
To deal with message formatting, the message gets turned into an array of characters first.
Twitch provides the IDs of the emotes and from where to where they are located in the message.
We replace those emote-related characters with empty strings and place an <img> tag as a string at the 'from' location.
Other changes take place in a similar way, by calculating the 'from' and 'to' values ourselves.
As a last step, all entries in the array with 1 character are transformed into HTML entities if they are potentially dangerous.
At the end, we join() the character array again, forming a message safe to assign to the innerHTML property.
*/
function formatMessage(text, emotes) {
	var message = text.split('');
	message = formatEmotes(message, emotes);
	message = formatLinks(message, text);
	return formatEmotesExternal(htmlEntities(message).join(''));
}

var extEmoteMap = {}, 
	bttvResponse, bttvFailed, bttvReady,
	bttvgResponse,  bttvgFailed, bttvgReady,
	ffzResponse, ffzFailed, ffzReady;
function formatEmotesExternal(message) {
	if(!Settings.get('external-emotes') || !roomId) return message;

	// Has bttv Json been fetched? Or has it failed?
	if(!bttvResponse && !bttvFailed) 
		ajaxGetRequest("https://api.betterttv.net/3/cached/users/twitch/"+roomId, 
			(resp) => bttvResponse = resp, 
			() => bttvFailed = true
		);
		
	// Has bttv (Global) Json been fetched? Or has it failed?
	if(!bttvgResponse && !bttvgFailed) 
		ajaxGetRequest("https://api.betterttv.net/3/cached/emotes/global", 
			(resp) => bttvgResponse = resp, 
			() => bttvgFailed = true
		);

	// Has ffz Json been fetched? Or has it failed?
	if(!ffzResponse && !ffzFailed) 
	// https://api.frankerfacez.com/v1/room/"+Settings.get('channel')  Alternative url but does not always work
		ajaxGetRequest("https://api.betterttv.net/3/cached/frankerfacez/users/twitch/"+roomId, 
			(resp) => ffzResponse = resp, 
			() => ffzFailed = true
		);
	
	// Parse bttv?
	if(bttvResponse && !bttvReady) parseBTTV(bttvResponse);
	// Parse bttvg?
	if(bttvgResponse && !bttvgReady) parseBTTVg(bttvgResponse);
	// Parse ffzz?
	if(ffzResponse && !ffzReady) parseFFZ(ffzResponse);	
	
	// Ready to process emotes?
	if(!isObjectEmpty(extEmoteMap)) {
		let messageWords = message.match(/(?<=^([^"]|"[^"]*")*)(\w+)/g);  // Words without " in front (avoid collisions)
		if(messageWords) {
			let wordsToReplace = {};
			for( const word of messageWords) {
				if(word in extEmoteMap){ 
					wordsToReplace[word] = extEmoteMap[word]; // Save unique words that needs replacing
				}
			}
			// Replace emotes with images
			for( const word in wordsToReplace)
				message = message.replaceAll(word, wordsToReplace[word]);
		}
	}
	
	return message;
}

function resetBTTVFFZ() {
	bttvResponse = bttvFailed = bttvReady = ffzResponse = ffzFailed = ffzReady = null;
	extEmoteMap = {};
	// Reparse BTTC global?
	if(bttvgResponse && !bttvgReady) parseBTTVg(bttvgResponse);
}

function parseBTTV(bttvResponse) { // Add bttv to extEmoteMap
	let bttvJson = JSON.parse(bttvResponse);
	let emotes = bttvJson.channelEmotes.concat(bttvJson.sharedEmotes);
	for( const emote of emotes) {
		extEmoteMap[emote.code] = '<img class="emoticon" src="https://cdn.betterttv.net/emote/' + emote.id + '/1x" alt="'+ emote.code + ' (BTTV)" title="'+ emote.code + ' (BTTV)">';
	}
	bttvReady = true;
}

function parseBTTVg(bttvgResponse) {// Add bttvg to extEmoteMap
	let emotes = JSON.parse(bttvgResponse);
	for( const emote of emotes) {
		extEmoteMap[emote.code] = '<img class="emoticon" src="https://cdn.betterttv.net/emote/' + emote.id + '/1x" alt="'+ emote.code + ' (BTTV)" title="'+ emote.code + ' (BTTV)">';
	}
	bttvgReady = true;
}

function parseFFZ(ffzResponse) {// Add ffz to extEmoteMap
	let emotes = JSON.parse(ffzResponse);
	for( const emote of emotes) {
		extEmoteMap[emote.code] = '<img class="emoticon" src="' + emote.images["1x"] + '" alt="' + emote.code + ' (FFZ)" title="'+ emote.code + ' (FFZ)">';
	}
	ffzReady = true;
}


function formatEmotes(text, emotes) {
	if (!emotes) {
		return text;
	}
	for (var id in emotes) {
		emotes[id].forEach((range) => {
			if (typeof range == 'string') {
				range = range.split('-').map(index => parseInt(index));
				var emote = text.slice(range[0], range[1] + 1).join('');
				replaceText(text, `<img class="emoticon" src="https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/1.0" alt="${emote} (T)" title="${emote} (T)" />`, range[0], range[1]);
			}
		});
	};
	return text;
}

function formatLinks(text, originalText) {
	var urlRegex = /(https?:\/\/)?(www\.)?([0-9a-zA-Z-_\.]+\.[0-9a-zA-Z]+\/)([0-9a-zA-Z-_#=\/\.\?\|]+)?/g;
	var match;
	while ((match = urlRegex.exec(originalText)) !== null) {
		var urlText = url = match[0];
		if (!match[1]) {
			url = 'https://' + url;
		}
		var path = match[4] || '';
		if (Settings.get('inline-images')) {
			var giphy = /^https?:\/\/giphy\.com\/gifs\/(.*-)?([a-zA-Z0-9]+)$/gm.exec(urlText);
			if (giphy) {
				console.log('giphy', url);
				url = `https://media1.giphy.com/media/${giphy[2].split("-").pop()}/giphy.gif`;
				path = `media/${giphy[2].split("-").pop()}/giphy.gif`;
			}
			if (match[1] && imageExtensions.some((extension) => path.endsWith(extension))) {
				text.push(`<br /><img class="user-image" src="${url}" alt="" />`);
			}
		}
		if (Settings.get('unfurl-youtube') && (match[3] == 'youtube.com/' || match[3] == 'youtu.be/')) {
			var youtube = /^https?:\/\/(www\.)?(youtu\.be\/|youtube\.com\/watch\?v=)([^&?]+).*$/gm.exec(url);
			if (youtube) {
				text.push(`<br /><img src="https://img.youtube.com/vi/${youtube[3]}/maxresdefault.jpg" class="user-image" alt="YouTube video preview" data-hq="https://img.youtube.com/vi/${youtube[3]}/hqdefault.jpg" data-mq="https://img.youtube.com/vi/${youtube[3]}/mqdefault.jpg" />`);
			}
		}

		if (Settings.get('unfurl-twitter') && match[3] == 'twitter.com/' && match[4] != undefined) {
			var twitter = /^https?:\/\/(www\.)?twitter\.com.+\/([0-9]+)$/gm.exec(match[0]);
			if (twitter) {
				text.push(`<div data-tweet="${twitter[2]}"></div>`);
			}
		}
		if (Settings.get('shorten-urls')) {
			if (path.length < 25) {
				urlText = match[3] + path;
			} else {
				urlText = match[3] + ' &hellip; ';
				if (path.lastIndexOf('/') == -1) {
					urlText += path.slice(-7); // No directory structure in the URL
				} else {
					urlText += path.substring(path.lastIndexOf('/')).slice(-10); // Show last directory if it is not too long
				}
			}
		}
		var replacement = Settings.get('format-urls') ? `<a href="${url}" target="_blank" rel="noreferrer noopener">${urlText}</a>` : urlText;
		replaceText(text, replacement, match.index, match.index + match[0].length - 1);
	}
	return text;
}

function updateEvenOddRows() { //if(Settings.get('fade-messages-dump')) 
	let chatLines = Settings.get('fade-messages-dump') ? 
		Array.prototype.concat.call(...document.querySelectorAll('#chat > div.spammymsg'), ...document.querySelectorAll('#chat > div:not(.spammymsg)')) 
		: document.querySelectorAll('#chat > div');
	let oddLine = false, c = chatLines.length;	
	while(c--) {
		if(oddLine) {
			chatLines[c].classList.add('oddline'); 
			oddLine = false;
		} else {
			chatLines[c].classList.remove('oddline');
			oddLine = true;
		}
	}
}

function ensureHash(text) {
	if (!text.startsWith('#')) {
		return '#' + text;
	}
	return text;
}

function removeHash(text) {
	if (text.startsWith('#')) {
		return text.substring(1);
	}
	return text;
}

function replaceText(text, replacement, from, to) {
	for (var i = from + 1; i <= to; i++) {
		text[i] = '';
	}
	text.splice(from, 1, replacement);
}

function htmlEntities(html) {
	return html.map((character) => {
		if (character.length == 1) {
			return character.replace(/[\u00A0-\u9999<>\&]/gim, (match) => '&#' + match.charCodeAt(0) + ';');
		}
		return character;
	});
}

var requestQueue = {};
function ajaxGetRequest(url, callback, failCallback) {
	if(requestQueue[url]) return; // Only one request at a time for each url
	requestQueue[url] = 1;
	var xhr = new XMLHttpRequest();
	xhr.open("GET", url, true);
	xhr.onload = function (e) {
		if (xhr.readyState === 4) {
			delete requestQueue[url];
			if (xhr.status === 200) {
				callback(xhr.responseText);
			} else {
				failCallback();
			}
		}
	};
	xhr.onerror = function (e) {
		delete requestQueue[url];
		failCallback();
	};
	xhr.send(null); 
}	

function isObjectEmpty(obj) {
	return obj && Object.keys(obj).length === 0 && obj.constructor === Object;
}	