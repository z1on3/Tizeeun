// Fallback "source" used when no connected server has the title.
// Plays a Creative Commons demo clip (Big Buck Bunny, (c) Blender Foundation, CC BY 3.0)
// so the player flow can be exercised end to end.
var PlaceholderProvider = {
  type: 'placeholder',
  label: 'Placeholder',
  findSource: function (item) {
    return Promise.resolve({
      url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
      title: item.title,
      note: Store.get().servers.length
        ? 'Not found on your servers. Playing a placeholder video.'
        : 'Placeholder video. Add a media server in Settings to play your own copy of this title.',
      startSeconds: 0
    });
  }
};
