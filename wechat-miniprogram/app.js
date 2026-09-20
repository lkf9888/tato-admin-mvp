App({
  globalData: {
    apiBaseUrl: "https://tatocar.co",
    /**
     * The last session response from the notification hub: channels,
     * template ids and remaining quota. Cached here so a page opened
     * from a tapped notification can ask for an authorisation without
     * first waiting on a round trip.
     */
    hubState: null
  }
});
