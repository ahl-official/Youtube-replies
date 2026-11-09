// The two channels this desk can review. Keys are what the browser sends.
const LIST = [
  {
    key: 'ahl',
    name: 'American Hairline',
    channelId: 'UCKNwds5t-KBGMp6VzvfAr6A',
    handle: '@AmericanHairline',
    topic: 'hair patches, hair systems and wigs',
  },
  {
    key: 'alchemane',
    name: 'Alchemane',
    channelId: 'UC-4qTtMQtEYL7xwjpgxfwBg',
    handle: '@AlchemaneHairExtensions',
    topic: "women's hair extensions and wigs",
  },
];

const BY_KEY = new Map(LIST.map((channel) => [channel.key, channel]));
const BY_ID = new Map(LIST.map((channel) => [channel.channelId, channel]));

function byKey(key) {
  return BY_KEY.get(key) || LIST[0];
}

function byId(channelId) {
  return BY_ID.get(channelId) || null;
}

module.exports = { LIST, byKey, byId };
