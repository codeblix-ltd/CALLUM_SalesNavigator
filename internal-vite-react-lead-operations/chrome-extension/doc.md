the goal is that the scout simply click on 'execute' from the chrome extension and it should visit each profile url, read its post, find 3 posts to engage and like/react and then comment something based on the post content automatically. (in order to write a post, it will use openai subscription where i will first auth it on my react app where i will allow the credential to be saved on our db and then the chrome extension will indeed access the openai model and use model gpt 5.6 luna only to read post and comments)
- and then it should mark them in the db for the leads that was engaged by the plugins as 'engaged' or something
- and then in the same plugin, there should be a field where the scout can configure the number of post to engage and the interval in minutes (ofc they can put it as hours or days) and also have another field where they can put number of min or hours or days to add the lead and have another field whether to enable additional note when adding the connection request or can simply add the lead without a additional note. and incase of any errors, it should track it too.
- and for any leads that was added as connection request or additional note, it should clearly saved it in db so we know its status etc.
- and on the chrome extension, it should also show another status for leads engaged, leads added, and leads accepted
- the leads accepted is when the leads has succesfully accepted the connection request.
- i think each day, the chrome extension need to check automatically whether the leads has accepted the request or not from the page https://www.linkedin.com/mynetwork/invitation-manager/sent/ i think or better way, idk, u decide the best effective way. or also let the chrome extension to have a btn where the user can itself click on a btn and let the chrome extension check which leads accepted the friend request at https://www.linkedin.com/mynetwork/invitation-manager/sent/ or if there is a better way. idk, u decide. but i know at page https://www.linkedin.com/mynetwork/invitation-manager/sent/, we need to scrool at bottom to see more results, so sometime this can suck, see whether u can do this using the networkd api request or whatever. u decide the best effective way.
- and when a lead is accepted, it must auto collect the lead email from their profile by visiting their profile and view the https://www.linkedin.com/in/antish-software-developer/overlay/contact-info/ i think and click on the contact info btn to get the email address.

and thats it, thats the whole process.

free feel to use the inbuilt codex chatgpt browser to visit linkedin and do whatever u want.


1 linkedin profile sample:
https://www.linkedin.com/in/jeremyharbour/

to find recent posts:
https://www.linkedin.com/in/jeremyharbour/recent-activity/all/

<section class="artdeco-card pb3">
<!---->
  
            <h2 class="text-heading-large ph5 pt5 pb2">
              All activity
            </h2>
            
          
  
    
    <div class="mb3">
      
        
      <div class="pv2 ph5">
        <div class="display-flex white-space-nowrap" role="group" aria-label="Select type of recent activity">
            
  <button aria-pressed="true" tabindex="0" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      artdeco-pill--selected" id="content-collection-pill-0" type="button">
    <span class="artdeco-pill__text">Posts</span>
<!---->  </button>

            
  <button aria-pressed="false" tabindex="-1" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      " id="content-collection-pill-1" type="button">
    <span class="artdeco-pill__text">Events</span>
<!---->  </button>

            
  <button aria-pressed="false" tabindex="-1" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      " id="content-collection-pill-2" type="button">
    <span class="artdeco-pill__text">Comments</span>
<!---->  </button>

            
  <button aria-pressed="false" tabindex="-1" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      " id="content-collection-pill-3" type="button">
    <span class="artdeco-pill__text">Videos</span>
<!---->  </button>

            
  <button aria-pressed="false" tabindex="-1" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      " id="content-collection-pill-4" type="button">
    <span class="artdeco-pill__text">Images</span>
<!---->  </button>

            
  <button aria-pressed="false" tabindex="-1" class="profile-creator-shared-pills__pill artdeco-pill artdeco-pill--slate artdeco-pill--choice artdeco-pill--3 artdeco-pill--toggle
      " aria-expanded="false" id="overflow-button-ember62" type="button">
    <span class="artdeco-pill__text">More</span>
      <svg role="none" aria-hidden="true" class="artdeco-pill__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="caret-small">
<!---->    
    <use href="#caret-small" width="16" height="16"></use>
</svg>

  </button>

            <div id="ember63" class="artdeco-dropdown artdeco-dropdown--placement-bottom artdeco-dropdown--justification-right ember-view inline-block">
              <div tabindex="-1" aria-hidden="true" id="ember64" class="artdeco-dropdown__content artdeco-dropdown--is-dropdown-element artdeco-dropdown__content--has-arrow artdeco-dropdown__content--arrow-right artdeco-dropdown__content--justification-right artdeco-dropdown__content--placement-bottom ember-view"><!----></div>
            </div>
        </div>
      </div>
  
      
    </div>
    <div class="pv0 ph5">
      
          
      <div>
        
              
    <div class="scaffold-finite-scroll
    scaffold-finite-scroll--infinite
     full-width">
  <!---->
  
      <div class="scaffold-finite-scroll__content">
        
<!---->
          <div class="visually-hidden" aria-live="polite">
            Loaded 20 Posts posts
          </div>
            <ul class="display-flex flex-wrap list-style-none justify-center">
                  <li class="TTdwYLVHXkPQERFTFZjArPRCWQGYxxsI">
                    <div>
  
                          
    <div class="relative artdeco-card">
      <div class="profile-creator-shared-feed-update__anchor"></div>
<!---->      
      
        
        
          
    <div class="full-height" data-view-name="feed-full-update" data-view-tracking-scope="[{&quot;topicName&quot;:&quot;FeedUpdateServedEvent&quot;,&quot;contentTrackingId&quot;:&quot;4/EWAMckzbhN85ZoAmYCSQ==&quot;,&quot;breadcrumb&quot;:{&quot;$type&quot;:&quot;proto.sdui.breadcrumbs.feed.FeedUpdateServedBreadcrumb&quot;,&quot;updateUrn&quot;:&quot;urn:li:activity:7486042476307222528&quot;,&quot;moduleKey&quot;:&quot;member-activity:desktop&quot;,&quot;requestId&quot;:&quot;4913e4a8-bdf6-4686-92d7-fa5a28db6137&quot;,&quot;trackingId&quot;:&quot;4/EWAMckzbhN85ZoAmYCSQ==&quot;,&quot;trackingPipelineType&quot;:&quot;BREADCRUMB&quot;,&quot;actionEventTopicName&quot;:&quot;FeedActionEvent&quot;,&quot;impressionEventTopicName&quot;:&quot;FeedImpressionEvent&quot;}}]">
      <div class="full-height">
        <div class="feed-shared-update-v2 feed-shared-update-v2--minimal-padding full-height feed-shared-update-v2--with-carousel-fix relative
            
            
            
            
            feed-shared-update-v2--wrapped
            
            
            
            " id="ember105" role="article" data-urn="urn:li:activity:7486042476307222528">
          
      <div>
        
              <div class="feed-shared-update-v2__control-menu-container display-flex flex-column flex-grow-1 full-height">
                
                <h2 class="visually-hidden">
                    Feed post number 1
                </h2>
                <div class="fie-impression-container">
<!---->                  <div class="relative">
                      
    <div class="PtyULkAiaizGLoDbdmsAxaQFbObCRGPrAg
        display-flex align-items-flex-start
        update-components-actor--with-control-menu
        
        ">
<!---->
      <div class="update-components-actor__container
          
          display-flex flex-grow-1">
          <a class="XQidInOZdUqrHGlQkkUpVUZDTyqjTPrnrE  update-components-actor__image relative
              " aria-label="View Jeremy Harbour’s  graphic link" target="_self" href="https://www.linkedin.com/in/jeremyharbour?miniProfileUrn=urn%3Ali%3Afsd_profile%3AACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o" data-test-app-aware-link="">
            <span class="js-update-components-actor__avatar">
              
    <div class="ivm-image-view-model    update-components-actor__avatar">
        
    <div class="ivm-view-attr__img-wrapper
        
        ">
<!---->
<!---->          <img width="48" src="https://media.licdn.com/dms/image/v2/D4E03AQGEZFA53MN7jw/profile-displayphoto-shrink_100_100/B4EZbLxiEXHkAU-/0/1747175482005?e=1787184000&amp;v=beta&amp;t=7kRopXsYaSTZgkuw3o3ugU33fb2U17-P_aRTK8KHpqQ" loading="lazy" height="48" alt="View Jeremy Harbour’s  graphic link" id="ember106" class="ivm-view-attr__img--centered EntityPhoto-circle-3  update-components-actor__avatar-image evi-image lazy-image ember-view">
    </div>
  
          </div>
  
            </span>
          </a>
        <div class="update-components-actor__meta
            ">
          <a class="XQidInOZdUqrHGlQkkUpVUZDTyqjTPrnrE  update-components-actor__meta-link" aria-label="View: Jeremy Harbour 2nd Founder and CEO of Unity Group &amp;amp; Associated Companies" target="_self" href="https://www.linkedin.com/in/jeremyharbour?miniProfileUrn=urn%3Ali%3Afsd_profile%3AACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o" data-test-app-aware-link="">
            <span class="update-components-actor__title">
              <span class="SRTzwZCRAECaLxKkAQpWmALKYPbGvXCGYsY
                  hoverable-link-text t-14 t-bold text-body-medium-bold
                  t-black
                  
                  update-components-actor__single-line-truncate">
                <span dir="ltr"><span aria-hidden="true"><!---->Jeremy Harbour<!----></span><span class="visually-hidden"><!---->Jeremy Harbour<!----></span></span>
              </span>
                <span class="update-components-actor__supplementary-actor-info update-components-actor__supplementary-actor-info--align-icon update-components-actor__single-line-truncate text-body-xsmall
                    t-black--light
                    flex-shrink-zero">
                  <span aria-hidden="true"><span class="white-space-pre"> </span>• 2nd<!----></span><span class="visually-hidden"><!---->2nd<!----></span>
                </span>
            </span>

              <span class="update-components-actor__description text-body-xsmall
                  t-black--light">
                <span aria-hidden="true"><!---->Founder and CEO of Unity Group &amp; Associated Companies<!----></span><span class="visually-hidden"><!---->Founder and CEO of Unity Group &amp; Associated Companies<!----></span>
              </span>

          </a>
<!---->            <span class="update-components-actor__sub-description text-body-xsmall
                t-black--light
                
                ">
              <span aria-hidden="true"><!---->1w •<span class="white-space-pre"> </span><span><li-icon aria-hidden="true" type="globe-americas" class="v-align-bottom" size="small"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" data-supported-dps="16x16" fill="currentColor" class="mercado-match" width="16" height="16" focusable="false">
      <path d="M8 1a7 7 0 107 7 7 7 0 00-7-7zM3 8a5 5 0 011-3l.55.55A1.5 1.5 0 015 6.62v1.07a.75.75 0 00.22.53l.56.56a.75.75 0 00.53.22H7v.69a.75.75 0 00.22.53l.56.56a.75.75 0 01.22.53V13a5 5 0 01-5-5zm6.24 4.83l2-2.46a.75.75 0 00.09-.8l-.58-1.16A.76.76 0 0010 8H7v-.19a.51.51 0 01.28-.45l.38-.19a.74.74 0 01.68 0L9 7.5l.38-.7a1 1 0 00.12-.48v-.85a.78.78 0 01.21-.53l1.07-1.09a5 5 0 01-1.54 9z"></path>
    </svg></li-icon></span><span class="white-space-pre"> </span><!----><!----></span><span class="visually-hidden"><!---->1 week ago • Visible to anyone on or off LinkedIn<!----></span>
            </span>
        </div>
      </div>

        
    <button class="follow   update-components-actor__follow-button update-components-update-v2__follow-button update-components-actor__cta-button--lockup-redesign artdeco-button text-body-medium-bold
            
            update-components-update-v2__cta-button--next-to-control-menu
            
            artdeco-button--tertiary
            " aria-label="Follow Jeremy Harbour" aria-pressed="false" type="button">
          <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="add-small">
<!---->    
    <use href="#add-small" width="16" height="16"></use>
</svg>

        <span aria-hidden="true">Follow</span>
    </button>
  

<!---->    </div>
  
                        
    <div class="feed-shared-control-menu display-flex
        feed-shared-update-v2__control-menu absolute text-align-right
        
        ">
<!---->
        <div id="ember108" class="artdeco-dropdown artdeco-dropdown--placement-bottom artdeco-dropdown--justification-right ember-view">
          <button aria-expanded="false" aria-label="Open control menu for post by Jeremy Harbour" tabindex="0" id="ember109" class="feed-shared-control-menu__trigger artdeco-button artdeco-button--tertiary artdeco-button--muted artdeco-button--1 artdeco-button--circle artdeco-dropdown__trigger artdeco-dropdown__trigger--placement-bottom ember-view" type="button">
              
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.25 8C3.25 8.69 2.69 9.25 2 9.25C1.31 9.25 0.75 8.69 0.75 8C0.75 7.31 1.31 6.75 2 6.75C2.69 6.75 3.25 7.31 3.25 8ZM14 6.75C13.31 6.75 12.75 7.31 12.75 8C12.75 8.69 13.31 9.25 14 9.25C14.69 9.25 15.25 8.69 15.25 8C15.25 7.31 14.69 6.75 14 6.75ZM8 6.75C7.31 6.75 6.75 7.31 6.75 8C6.75 8.69 7.31 9.25 8 9.25C8.69 9.25 9.25 8.69 9.25 8C9.25 7.31 8.69 6.75 8 6.75Z" fill="currentColor"></path>
  </svg>

                      
<!----></button>
          <div tabindex="-1" aria-hidden="true" id="ember110" class="feed-shared-control-menu__content artdeco-dropdown__content artdeco-dropdown--is-dropdown-element artdeco-dropdown__content--has-arrow artdeco-dropdown__content--arrow-right artdeco-dropdown__content--justification-right artdeco-dropdown__content--placement-bottom ember-view" aria-label="Control Menu Options"><!----></div>
        </div>

<!---->
<!---->
<!---->
<!---->
<!---->
<!----><!---->    </div>
  
                                      </div>
<!---->
                  <!---->

<!---->                          
    <div class="NKCczKGrSxgSdtxCfoyDNrBeDuzSHmoscJU" style="" tabindex="-1">
          
    <div class="feed-shared-inline-show-more-text
        feed-shared-update-v2__description feed-shared-inline-show-more-text--minimal-padding
        
        feed-shared-inline-show-more-text--3-lines
        
        
        
        " tabindex="-1">
      
            
    <div class="update-components-text relative update-components-update-v2__commentary " dir="ltr">
<!---->
      <span class="break-words
          tvm-parent-container">
<!---->        <span dir="ltr"><span><a tabindex="0" href="/in/timothyarmoo/" id="ember111" class="ember-view"><!---->Timothy Armoo<!----></a></span><span class="white-space-pre"> </span>sold his first business at 17.<!----><span><br></span><span><br></span><!---->He then sold Fanbytes, his influencer marketing agency, for eight figures at just 27.<!----><span><br></span><span><br></span><!---->This week, in the first episode of Deal Junky LIVE, we’re getting into how he thinks about his exits from the very beginning and what most founders get wrong about timing.<!----><span><br></span><span><br></span><!---->What I found most interesting wasn't the exit itself, it was how early he started planning for it and what he was watching for when the right moment came.<!----><span><br></span><span><br></span><!---->When he started Fanbytes in 2017, he wasn't trying to build the best agency in the room, he was watching the market.<!----><span><br></span><span><br></span><!---->He'd seen the same pattern play out in radio, TV, and PR. Consolidation always comes eventually. His job was just to still be standing when it did. Or, in his words "just don't die!".<!----><span><br></span><span><br></span><!---->He knew the moment had arrived when three companies reached out to "partner up" in the space of six weeks. He went to market shortly after.<!----><span><br></span><span><br></span><!---->Our audience gained a wealth of knowledge from this episode, I hope you enjoy it as much as we did.<!----><span><br></span><span><br></span><!---->→ Watch the full episode here:<span class="white-space-pre"> </span><a class="XQidInOZdUqrHGlQkkUpVUZDTyqjTPrnrE " target="_self" tabindex="0" href="https://lnkd.in/dbcQhz5P" data-test-app-aware-link=""><!---->https://lnkd.in/dbcQhz5P<!----></a></span>
      </span>
    </div>
  
          <button role="button" class="feed-shared-inline-show-more-text__see-more-less-toggle see-more t-14 t-black--light t-normal hoverable-link-text feed-shared-inline-show-more-text__dynamic-more-text feed-shared-inline-show-more-text__dynamic-bidi-text" aria-label="see more, visually reveals content which is already detected by screen readers" style="left:399.67449951171875px" type="button">
          <span>…more</span>
        </button><!---->    </div>
  
        
<!---->    </div>
  
                          
    <div class="update-components-linkedin-video
        feed-shared-update-v2__content
        
        
        ">
          <div class="update-components-linkedin-video__container">
<!---->              
      
    
    <div class="video-s-loader
        
        video-s-loader--video-loading">
<!---->
      <div data-player-id="ember113" class="media-player video-s-loader__video-container
          video-s-loader__video-container--immersive-player-controls">

  
        

<!---->
        <!---->
          <!---->
          <!---->
          <!---->
          <!---->
          <!---->

<!---->
<!---->      

  <div data-vjs-player="" class="ember-view video-js media-player__player vjs-fluid media-player--use-mercado vjs-controls-enabled vjs-touch-enabled vjs-workinghover vjs-v7 vjs-layout-medium vjs-4-5 vjs-has-started vjs-paused vjs-user-inactive" id="ember114" tabindex="-1" role="region" lang="en" translate="no" aria-label="Video player"><div class="vjs-poster-background" style="background-image: url(&quot;https://media.licdn.com/dms/image/v2/D4D05AQGHqesxVGTTpg/videocover-high/B4DZ.OTGafI4BQ-/0/1784798802467?e=1786194000&amp;v=beta&amp;t=sA8xXRFNjx5JiuUiHzEh3V1TkMyiPWZDk0D60F64RE4&quot;);"></div><video id="ember114_html5_api" class="vjs-tech" tabindex="-1" role="application" preload="metadata" muted="muted" poster="https://media.licdn.com/dms/image/v2/D4D05AQGHqesxVGTTpg/videocover-high/B4DZ.OTGafI4BQ-/0/1784798802467?e=1786194000&amp;v=beta&amp;t=sA8xXRFNjx5JiuUiHzEh3V1TkMyiPWZDk0D60F64RE4" src="https://dms.licdn.com/playlist/vid/v2/D4D05AQGHqesxVGTTpg/mp4-720p-30fp-crf28/B4DZ.OTGafI4CA-/0/1784798805717?e=1786194000&amp;v=beta&amp;t=y_PgvytyUpv0eWd6Qw-SYBJY6t3Z47bHwcQVywAMM4Y" autoplay="autoplay"></video>
      
  <div class="visually-hidden" aria-live="polite"></div><div class="vjs-poster" tabindex="-1" aria-disabled="false" style="background-image: url(&quot;https://media.licdn.com/dms/image/v2/D4D05AQGHqesxVGTTpg/videocover-high/B4DZ.OTGafI4BQ-/0/1784798802467?e=1786194000&amp;v=beta&amp;t=sA8xXRFNjx5JiuUiHzEh3V1TkMyiPWZDk0D60F64RE4&quot;);"></div><button class="vjs-big-play-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Play</span></button><div class="vjs-loading-spinner" dir="ltr"><span class="vjs-control-text">Media is loading</span></div><div class="vjs-control-bar vjs-control-bar--inline" dir="ltr"><button class="vjs-play-control vjs-control vjs-button vjs-paused" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Play</span><div class="vjs-tooltip-container vjs-tooltip-left"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Play</div></div></button><div class="vjs-progress-control vjs-control"><div tabindex="0" class="vjs-progress-holder vjs-slider vjs-slider-horizontal" role="slider" aria-valuenow="25.29" aria-valuemin="0" aria-valuemax="100" aria-label="Playback progress" aria-valuetext="0:09 of 0:35"><div class="vjs-load-progress" style="width: 100%;"><span class="vjs-control-text"><span>Loaded</span>: <span class="vjs-control-text-loaded-percentage">100.00%</span></span><div data-start="0" data-end="35.866667" style="left: 0%; width: 100%;"></div></div><div class="vjs-mouse-display"><div class="vjs-time-tooltip" aria-hidden="true"></div></div><div class="vjs-play-progress vjs-slider-bar" aria-hidden="true" style="width: 25.29%;"><div class="vjs-time-tooltip" aria-hidden="true" style="right: 0px;">0:09</div></div></div></div><div class="vjs-live-control vjs-control vjs-hidden"><div class="vjs-live-display" aria-live="off"><span class="vjs-control-text">Stream Type&nbsp;</span>LIVE</div></div><div class="vjs-remaining-time vjs-time-control vjs-control"><span class="vjs-control-text" role="presentation">Remaining time&nbsp;</span><span aria-hidden="true">-</span><span class="vjs-remaining-time-display" aria-live="off" role="presentation">0:26</span></div><div class="vjs-custom-control-spacer vjs-spacer ">&nbsp;</div><div class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-control vjs-button"><div class="vjs-playback-rate-value" id="vjs-playback-rate-value-label-ember114_component_341" aria-hidden="true">1x</div><button class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-button" type="button" aria-disabled="false" aria-haspopup="true" aria-expanded="false" aria-describedby="vjs-playback-rate-value-label-ember114_component_341"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Playback speed</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Playback speed</div></div></button><div class="vjs-menu"><ul class="vjs-menu-content" role="menu" tabindex="-1" style="max-height: 553.75px;"><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">0.5x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">0.75x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-selected vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="true"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1x</span><span class="vjs-control-text" aria-live="polite">, selected</span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.25x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.5x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.75x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">2x</span><span class="vjs-control-text" aria-live="polite"></span></li></ul></div></div><button class="vjs-control vjs-button vjs-captions-toggle" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Turn closed captions on</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Show captions</div></div></button><div class="vjs-volume-panel vjs-control vjs-volume-panel-vertical"><button class="vjs-mute-control vjs-control vjs-button vjs-vol-0" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Unmute</span></button><div class="vjs-volume-control vjs-control vjs-volume-vertical" style="max-height: 586.758px;"><div tabindex="0" class="vjs-volume-bar vjs-slider-bar vjs-slider vjs-slider-vertical" role="slider" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Volume" aria-live="polite" aria-valuetext="0%"><div class="vjs-mouse-display"><div class="vjs-volume-tooltip" aria-hidden="true"></div></div><div class="vjs-volume-level" style="height: 0%;"><span class="vjs-control-text"></span></div></div></div></div><button class="vjs-fullscreen-control vjs-control vjs-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Turn fullscreen on</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Fullscreen</div></div></button></div><div class="vjs-error-display vjs-modal-dialog vjs-hidden " tabindex="-1" aria-describedby="ember114_component_466_description" aria-hidden="true" aria-label="Modal window" role="dialog"><p class="vjs-modal-dialog-description vjs-control-text" id="ember114_component_466_description">Media player modal window</p><div class="vjs-modal-dialog-content" role="document"></div></div><div class="vjs-text-track-display" translate="yes" aria-live="off" aria-atomic="true"><div style="position: absolute; inset: 0px; margin: 1.5%;"></div></div><div class="vjs-modal-dialog vjs-hidden vjs-screen vjs-end-screen" tabindex="-1" aria-describedby="ember302_description" aria-hidden="true" aria-label="Modal window" role="dialog"><p class="vjs-modal-dialog-description vjs-control-text" id="ember302_description">Media player modal window This modal can be closed by pressing the Escape key or activating the close button.</p><div class="vjs-modal-dialog-content" role="document" id="ember302"></div><button class="vjs-close-button vjs-control vjs-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Close modal window</span></button></div></div>

<!----></div>

<!---->    </div>
  
  
  
                      </div>
<!----><!----><!----><!---->    </div>
  
<!---->
<!---->
                      <!---->

                        <!---->

                  <!---->

<!---->
                    
    
    <div id="ember115" class="update-v2-social-activity
        
        ">
      
          
    <div class="social-details-social-counts social-details-social-counts--no-vertical-padding
        
        
        
        
        ">
      <div class="display-flex flex-grow-1 full-width">
        <div class="relative full-width">
          <ul class="display-flex flex-wrap">
              <li class="social-details-social-counts__item social-details-social-counts__reactions social-details-social-counts__item--height-two-x
                  social-details-social-counts__reactions--left-aligned
                  ">
                <button data-reaction-details="" aria-label="13 reactions" class="t-black--light display-flex align-items-center social-details-social-counts__count-value social-details-social-counts__count-value-hover
                    text-body-small
                    hoverable-link-text
                    " type="button">
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--0 reactions-icon__consumption--small data-test-reactions-icon-type-LIKE data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/8ekq8gho1ruaf8i7f86vd1ftt" alt="like" data-test-reactions-icon-type="LIKE" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
  
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--1 reactions-icon__consumption--small reactions-icon--stacked data-test-reactions-icon-type-INTEREST data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/lhxmwiwoag9qepsh4nc28zus" alt="insightful" data-test-reactions-icon-type="INTEREST" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
  
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--2 reactions-icon__consumption--small reactions-icon--stacked data-test-reactions-icon-type-PRAISE data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/b1dl5jk88euc7e9ri50xy5qo8" alt="celebrate" data-test-reactions-icon-type="PRAISE" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
                      <span aria-hidden="true" class="social-details-social-counts__reactions-count
                        ">
13                    </span>
                </button>
              </li>

              <li data-non-reaction-details="" class="display-flex flex-grow-1 max-full-width">
                <ul class="display-flex flex-grow-1 max-full-width">
<!---->
                    <li class="social-details-social-counts__item social-details-social-counts__item--height-two-x flex-shrink-1 overflow-hidden
                        social-details-social-counts__item--right-aligned
                        ">
                        <button id="ember116" class="ember-view t-black--light social-details-social-counts__count-value-hover social-details-social-counts__item--truncate-text full-width
                            text-body-small
                            hoverable-link-text social-details-social-counts__btn
                            " aria-label="2 reposts of Jeremy Harbour’s post">
                          <span aria-hidden="true">
                            2 reposts
                          </span>
                        </button>
                    </li>

<!---->                </ul>
              </li>
          </ul>
        </div>
      </div>
    </div>
  

<!---->
<!---->
          
    <div class="feed-shared-social-action-bar
        
        feed-shared-social-action-bar--full-width
        
        feed-shared-social-action-bar--has-social-counts
        ">
      
<!---->              
    <span class="reactions-react-button feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
<!---->      <button aria-pressed="false" aria-label="React Like" id="ember118" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button react-button__trigger
          "><!---->
<span class="artdeco-button__text">
    
        <div class="flex-wrap justify-center
            artdeco-button__text align-items-center">
              <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="thumbs-up-outline-small">
<!---->    
    <use href="#thumbs-up-outline-small" width="16" height="16"></use>
</svg>


            <span aria-hidden="true" class="artdeco-button__text react-button__text social-action-button__text
                ">
              Like
            </span>
        </div>
      
</span></button>

      <button aria-label="Open reactions menu" aria-expanded="false" tabindex="0" id="ember119" class="artdeco-button artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view reactions-menu__trigger" data-finite-scroll-hotkey="l"><!---->
<span class="artdeco-button__text">
    
        <svg role="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="caret-small">
<!---->    
    <use href="#caret-small" width="16" height="16"></use>
</svg>

      
</span></button>
    </span>
  
              <span tabindex="-1" id="ember120" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
  <div>
    <button role="button" aria-label="Comment" tabindex="0" id="feed-shared-social-action-bar-comment-ember117" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button comment-button flex-wrap " data-finite-scroll-hotkey="c">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="comment-small">
<!---->    
    <use href="#comment-small" width="16" height="16"></use>
</svg>


<span class="artdeco-button__text">
    Comment
</span></button>
  </div>
  <div id="artdeco-gen-42" class="ember-view"><div id="ember123" class="ember-view"></div></div>
</span>
              
    <div id="ember124" class="artdeco-dropdown artdeco-dropdown--placement-bottom artdeco-dropdown--justification-right ember-view feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
      <span tabindex="-1" id="ember126" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view flex-1 display-flex">
        <button aria-expanded="false" aria-label="" tabindex="0" id="ember127" class="artdeco-dropdown__trigger artdeco-dropdown__trigger--placement-bottom ember-view 
            artdeco-button social-actions-button social-reshare-button flex-wrap
            artdeco-button--muted artdeco-button--3 artdeco-button--tertiary" data-finite-scroll-hotkey="r" type="button">
            <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="repost-small">
<!---->    
    <use href="#repost-small" width="16" height="16"></use>
</svg>

            <span class="artdeco-button__text social-action-button__text">Repost</span>
        
<!----></button>

        <div tabindex="-1" aria-hidden="true" id="ember128" class="artdeco-dropdown__content artdeco-dropdown--is-dropdown-element artdeco-dropdown__content--justification-right artdeco-dropdown__content--placement-bottom ember-view social-reshare-button__share-dropdown-content"><!----></div>

        <div id="artdeco-gen-43" class="ember-view"><div id="ember130" class="ember-view"></div></div>
      </span>
        <div>
  
      
<!---->  
  
</div>

<!---->
<!---->    </div>
  
                <div class="feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
                  <span tabindex="-1" id="ember131" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view">
                    
    <button aria-label="Send in a private message" id="ember132" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button send-privately-button flex-wrap
         send-privately-button" data-finite-scroll-hotkey="s" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="send-privately-small" data-rtl="true">
<!---->    
    <use href="#send-privately-small" width="16" height="16"></use>
</svg>


<span class="artdeco-button__text">
    
        <span class="artdeco-button__text social-action-button__text">
          Send
        </span>
    
</span></button>
  
                    <div id="artdeco-gen-44" class="ember-view"><div id="ember134" class="ember-view"></div></div>
                  </span>
                </div>
<!----><!---->          
    </div>
  
<!----><!----><!---->    
    </div>
  
  
                  <!---->                </div>

                  
    
    <div id="ember135" class="update-v2-social-activity
        
        ">
      
<!----><!---->
<!---->
<!---->
          
<!---->                    

<!---->
          <div class="feed-shared-update-v2__comments-container display-flex flex-column
              ">
<!----><!---->          </div>
    
    </div>
  
  

<!---->
<!---->
<!---->
          
              </div>
          
      </div>
  
        </div>
      </div>
<!---->    </div>
<!---->  
        
  

<!---->      
  
    </div>
  
                    
</div>

                  </li>
                  <li class="TTdwYLVHXkPQERFTFZjArPRCWQGYxxsI">
                    <div>
  
                          
    <div class="relative artdeco-card">
      <div class="profile-creator-shared-feed-update__anchor"></div>
<!---->      
      
        
        
          
    <div class="full-height" data-view-name="feed-full-update" data-view-tracking-scope="[{&quot;topicName&quot;:&quot;FeedUpdateServedEvent&quot;,&quot;contentTrackingId&quot;:&quot;RpedceQIj59mNR52nsjdLQ==&quot;,&quot;breadcrumb&quot;:{&quot;$type&quot;:&quot;proto.sdui.breadcrumbs.feed.FeedUpdateServedBreadcrumb&quot;,&quot;updateUrn&quot;:&quot;urn:li:activity:7483506903587758080&quot;,&quot;moduleKey&quot;:&quot;member-activity:desktop&quot;,&quot;requestId&quot;:&quot;4913e4a8-bdf6-4686-92d7-fa5a28db6137&quot;,&quot;trackingId&quot;:&quot;RpedceQIj59mNR52nsjdLQ==&quot;,&quot;trackingPipelineType&quot;:&quot;BREADCRUMB&quot;,&quot;actionEventTopicName&quot;:&quot;FeedActionEvent&quot;,&quot;impressionEventTopicName&quot;:&quot;FeedImpressionEvent&quot;}}]">
      <div class="full-height">
        <div class="feed-shared-update-v2 feed-shared-update-v2--minimal-padding full-height feed-shared-update-v2--with-carousel-fix relative
            
            
            
            
            feed-shared-update-v2--wrapped
            
            
            
            " id="ember137" role="article" data-urn="urn:li:activity:7483506903587758080">
          
      <div>
        
              <div class="feed-shared-update-v2__control-menu-container display-flex flex-column flex-grow-1 full-height">
                
                <h2 class="visually-hidden">
                    Feed post number 2
                </h2>
                <div class="fie-impression-container">
<!---->                  <div class="relative">
                      
    <div class="PtyULkAiaizGLoDbdmsAxaQFbObCRGPrAg
        display-flex align-items-flex-start
        update-components-actor--with-control-menu
        
        ">
<!---->
      <div class="update-components-actor__container
          
          display-flex flex-grow-1">
          <a class="XQidInOZdUqrHGlQkkUpVUZDTyqjTPrnrE  update-components-actor__image relative
              " aria-label="View Jeremy Harbour’s  graphic link" target="_self" href="https://www.linkedin.com/in/jeremyharbour?miniProfileUrn=urn%3Ali%3Afsd_profile%3AACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o" data-test-app-aware-link="">
            <span class="js-update-components-actor__avatar">
              
    <div class="ivm-image-view-model    update-components-actor__avatar">
        
    <div class="ivm-view-attr__img-wrapper
        
        ">
<!---->
<!---->          <img width="48" src="https://media.licdn.com/dms/image/v2/D4E03AQGEZFA53MN7jw/profile-displayphoto-shrink_100_100/B4EZbLxiEXHkAU-/0/1747175482005?e=1787184000&amp;v=beta&amp;t=7kRopXsYaSTZgkuw3o3ugU33fb2U17-P_aRTK8KHpqQ" loading="lazy" height="48" alt="View Jeremy Harbour’s  graphic link" id="ember138" class="ivm-view-attr__img--centered EntityPhoto-circle-3  update-components-actor__avatar-image evi-image lazy-image ember-view">
    </div>
  
          </div>
  
            </span>
          </a>
        <div class="update-components-actor__meta
            ">
          <a class="XQidInOZdUqrHGlQkkUpVUZDTyqjTPrnrE  update-components-actor__meta-link" aria-label="View: Jeremy Harbour 2nd Founder and CEO of Unity Group &amp;amp; Associated Companies" target="_self" href="https://www.linkedin.com/in/jeremyharbour?miniProfileUrn=urn%3Ali%3Afsd_profile%3AACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o" data-test-app-aware-link="">
            <span class="update-components-actor__title">
              <span class="SRTzwZCRAECaLxKkAQpWmALKYPbGvXCGYsY
                  hoverable-link-text t-14 t-bold text-body-medium-bold
                  t-black
                  
                  update-components-actor__single-line-truncate">
                <span dir="ltr"><span aria-hidden="true"><!---->Jeremy Harbour<!----></span><span class="visually-hidden"><!---->Jeremy Harbour<!----></span></span>
              </span>
                <span class="update-components-actor__supplementary-actor-info update-components-actor__supplementary-actor-info--align-icon update-components-actor__single-line-truncate text-body-xsmall
                    t-black--light
                    flex-shrink-zero">
                  <span aria-hidden="true"><span class="white-space-pre"> </span>• 2nd<!----></span><span class="visually-hidden"><!---->2nd<!----></span>
                </span>
            </span>

              <span class="update-components-actor__description text-body-xsmall
                  t-black--light">
                <span aria-hidden="true"><!---->Founder and CEO of Unity Group &amp; Associated Companies<!----></span><span class="visually-hidden"><!---->Founder and CEO of Unity Group &amp; Associated Companies<!----></span>
              </span>

          </a>
<!---->            <span class="update-components-actor__sub-description text-body-xsmall
                t-black--light
                
                ">
              <span aria-hidden="true"><!---->2w • Edited •<span class="white-space-pre"> </span><span><li-icon aria-hidden="true" type="globe-americas" class="v-align-bottom" size="small"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" data-supported-dps="16x16" fill="currentColor" class="mercado-match" width="16" height="16" focusable="false">
      <path d="M8 1a7 7 0 107 7 7 7 0 00-7-7zM3 8a5 5 0 011-3l.55.55A1.5 1.5 0 015 6.62v1.07a.75.75 0 00.22.53l.56.56a.75.75 0 00.53.22H7v.69a.75.75 0 00.22.53l.56.56a.75.75 0 01.22.53V13a5 5 0 01-5-5zm6.24 4.83l2-2.46a.75.75 0 00.09-.8l-.58-1.16A.76.76 0 0010 8H7v-.19a.51.51 0 01.28-.45l.38-.19a.74.74 0 01.68 0L9 7.5l.38-.7a1 1 0 00.12-.48v-.85a.78.78 0 01.21-.53l1.07-1.09a5 5 0 01-1.54 9z"></path>
    </svg></li-icon></span><span class="white-space-pre"> </span><!----><!----></span><span class="visually-hidden"><!---->2 weeks ago • Edited • Visible to anyone on or off LinkedIn<!----></span>
            </span>
        </div>
      </div>

        
    <button class="follow   update-components-actor__follow-button update-components-update-v2__follow-button update-components-actor__cta-button--lockup-redesign artdeco-button text-body-medium-bold
            
            update-components-update-v2__cta-button--next-to-control-menu
            
            artdeco-button--tertiary
            " aria-label="Follow Jeremy Harbour" aria-pressed="false" type="button">
          <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="add-small">
<!---->    
    <use href="#add-small" width="16" height="16"></use>
</svg>

        <span aria-hidden="true">Follow</span>
    </button>
  

<!---->    </div>
  
                        
    <div class="feed-shared-control-menu display-flex
        feed-shared-update-v2__control-menu absolute text-align-right
        
        ">
<!---->
        <div id="ember140" class="artdeco-dropdown artdeco-dropdown--placement-bottom artdeco-dropdown--justification-right ember-view">
          <button aria-expanded="false" aria-label="Open control menu for post by Jeremy Harbour" tabindex="0" id="ember141" class="feed-shared-control-menu__trigger artdeco-button artdeco-button--tertiary artdeco-button--muted artdeco-button--1 artdeco-button--circle artdeco-dropdown__trigger artdeco-dropdown__trigger--placement-bottom ember-view" type="button">
              
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3.25 8C3.25 8.69 2.69 9.25 2 9.25C1.31 9.25 0.75 8.69 0.75 8C0.75 7.31 1.31 6.75 2 6.75C2.69 6.75 3.25 7.31 3.25 8ZM14 6.75C13.31 6.75 12.75 7.31 12.75 8C12.75 8.69 13.31 9.25 14 9.25C14.69 9.25 15.25 8.69 15.25 8C15.25 7.31 14.69 6.75 14 6.75ZM8 6.75C7.31 6.75 6.75 7.31 6.75 8C6.75 8.69 7.31 9.25 8 9.25C8.69 9.25 9.25 8.69 9.25 8C9.25 7.31 8.69 6.75 8 6.75Z" fill="currentColor"></path>
  </svg>

                      
<!----></button>
          <div tabindex="-1" aria-hidden="true" id="ember142" class="feed-shared-control-menu__content artdeco-dropdown__content artdeco-dropdown--is-dropdown-element artdeco-dropdown__content--has-arrow artdeco-dropdown__content--arrow-right artdeco-dropdown__content--justification-right artdeco-dropdown__content--placement-bottom ember-view" aria-label="Control Menu Options"><!----></div>
        </div>

<!---->
<!---->
<!---->
<!---->
<!---->
<!----><!---->    </div>
  
                                      </div>
<!---->
                  <!---->

<!---->                          
    <div class="NKCczKGrSxgSdtxCfoyDNrBeDuzSHmoscJU" style="" tabindex="-1">
          
    <div class="feed-shared-inline-show-more-text
        feed-shared-update-v2__description feed-shared-inline-show-more-text--minimal-padding
        
        feed-shared-inline-show-more-text--3-lines
        
        
        
        " tabindex="-1">
      
            
    <div class="update-components-text relative update-components-update-v2__commentary " dir="ltr">
<!---->
      <span class="break-words
          tvm-parent-container">
<!---->        <span dir="ltr"><!---->New episode of Deal Junky is up!<!----><span><br></span><span><br></span><span><a tabindex="0" href="/in/callumlaing/" id="ember143" class="ember-view"><!---->Callum Laing<!----></a></span><span class="white-space-pre"> </span>has been my business partner for about a decade. We've listed companies together and spent a lot of time in the same rooms.<!----><span><br></span><span><br></span><!---->In this episode, we got into something I think most entrepreneurs underestimate: how much of your success comes down to the network around you, and how most people fail to build one.<!----><span><br></span><span><br></span><!---->Callum has a framework for this he calls CARES. We walked through the whole thing, from how to get your first board seat with no prior experience, to how to get equity in deals without starting or buying a company yourself.<!----><span><br></span><span><br></span><!---->Definitely worth your time. Link's in the comments.<!----><span><br></span><span><br></span><!---->Give Callum a follow too at:<span class="white-space-pre"> </span><span><a tabindex="0" href="/in/callumlaing/" id="ember144" class="ember-view"><!---->Callum Laing<!----></a></span></span>
      </span>
    </div>
  
          <button role="button" class="feed-shared-inline-show-more-text__see-more-less-toggle see-more t-14 t-black--light t-normal hoverable-link-text feed-shared-inline-show-more-text__dynamic-more-text feed-shared-inline-show-more-text__dynamic-bidi-text" aria-label="see more, visually reveals content which is already detected by screen readers" style="left:393.52862548828125px" type="button">
          <span>…more</span>
        </button><!---->    </div>
  
        
<!---->    </div>
  
                          
    <div class="update-components-linkedin-video
        feed-shared-update-v2__content
        
        
        ">
          <div class="update-components-linkedin-video__container">
<!---->              
      
    
    <div class="video-s-loader
        
        video-s-loader--video-loading">
<!---->
      <div data-player-id="ember146" class="media-player video-s-loader__video-container
          video-s-loader__video-container--immersive-player-controls">

  
        

<!---->
        <!---->
          <!---->
          <!---->
          <!---->
          <!---->
          <!---->

<!---->
<!---->      

  <div data-vjs-player="" class="ember-view video-js media-player__player vjs-fluid media-player--use-mercado vjs-controls-enabled vjs-touch-enabled vjs-workinghover vjs-v7 vjs-layout-medium vjs-4-5 vjs-has-started vjs-paused vjs-user-inactive" id="ember147" tabindex="-1" role="region" lang="en" translate="no" aria-label="Video player"><div class="vjs-poster-background" style="background-image: url(&quot;https://media.licdn.com/dms/image/v2/D4D10AQEt2HmsOr9pFQ/videocover-high/B4DZ9rB0BRI8As-/0/1784207070320?e=1786194000&amp;v=beta&amp;t=7M68esJMNjo6w9HmKQtfOhenNnBAunZbjVdNh5AIjv0&quot;);"></div><video id="ember147_html5_api" class="vjs-tech" tabindex="-1" role="application" preload="metadata" muted="muted" poster="https://media.licdn.com/dms/image/v2/D4D10AQEt2HmsOr9pFQ/videocover-high/B4DZ9rB0BRI8As-/0/1784207070320?e=1786194000&amp;v=beta&amp;t=7M68esJMNjo6w9HmKQtfOhenNnBAunZbjVdNh5AIjv0" src="blob:https://www.linkedin.com/811feb26-d1b4-4075-a330-70a846687528" autoplay="autoplay"></video>
      
  <div class="visually-hidden" aria-live="polite"></div><div class="vjs-poster" tabindex="-1" aria-disabled="false" style="background-image: url(&quot;https://media.licdn.com/dms/image/v2/D4D10AQEt2HmsOr9pFQ/videocover-high/B4DZ9rB0BRI8As-/0/1784207070320?e=1786194000&amp;v=beta&amp;t=7M68esJMNjo6w9HmKQtfOhenNnBAunZbjVdNh5AIjv0&quot;);"></div><button class="vjs-big-play-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Play</span></button><div class="vjs-loading-spinner" dir="ltr"><span class="vjs-control-text">Media is loading</span></div><div class="vjs-control-bar vjs-control-bar--inline" dir="ltr"><button class="vjs-play-control vjs-control vjs-button vjs-paused" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Play</span><div class="vjs-tooltip-container vjs-tooltip-left"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Play</div></div></button><div class="vjs-progress-control vjs-control"><div tabindex="0" class="vjs-progress-holder vjs-slider vjs-slider-horizontal" role="slider" aria-valuenow="2.74" aria-valuemin="0" aria-valuemax="100" aria-label="Playback progress" aria-valuetext="0:01 of 0:52"><div class="vjs-load-progress" style="width: 15.26%;"><span class="vjs-control-text"><span>Loaded</span>: <span class="vjs-control-text-loaded-percentage">15.26%</span></span><div data-start="0" data-end="8" style="left: 0%; width: 100%;"></div></div><div class="vjs-mouse-display"><div class="vjs-time-tooltip" aria-hidden="true"></div></div><div class="vjs-play-progress vjs-slider-bar" aria-hidden="true" style="width: 2.74%;"><div class="vjs-time-tooltip" aria-hidden="true" style="right: 0px;">0:01</div></div></div></div><div class="vjs-live-control vjs-control vjs-hidden"><div class="vjs-live-display" aria-live="off"><span class="vjs-control-text">Stream Type&nbsp;</span>LIVE</div></div><div class="vjs-remaining-time vjs-time-control vjs-control"><span class="vjs-control-text" role="presentation">Remaining time&nbsp;</span><span aria-hidden="true">-</span><span class="vjs-remaining-time-display" aria-live="off" role="presentation">0:51</span></div><div class="vjs-custom-control-spacer vjs-spacer ">&nbsp;</div><div class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-control vjs-button"><div class="vjs-playback-rate-value" id="vjs-playback-rate-value-label-ember147_component_786" aria-hidden="true">1x</div><button class="vjs-playback-rate vjs-menu-button vjs-menu-button-popup vjs-button" type="button" aria-disabled="false" aria-haspopup="true" aria-expanded="false" aria-describedby="vjs-playback-rate-value-label-ember147_component_786"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Playback speed</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Playback speed</div></div></button><div class="vjs-menu"><ul class="vjs-menu-content" role="menu" tabindex="-1" style="max-height: 553.75px;"><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">0.5x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">0.75x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-selected vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="true"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1x</span><span class="vjs-control-text" aria-live="polite">, selected</span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.25x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.5x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">1.75x</span><span class="vjs-control-text" aria-live="polite"></span></li><li class="vjs-menu-item vjs-menu-item-checkable" tabindex="-1" role="menuitemradio" aria-disabled="false" aria-checked="false"><span class="vjs-icon-placeholder"></span><span class="vjs-menu-item-text">2x</span><span class="vjs-control-text" aria-live="polite"></span></li></ul></div></div><button class="vjs-control vjs-button vjs-hidden vjs-captions-toggle" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Turn closed captions on</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Show captions</div></div></button><div class="vjs-volume-panel vjs-control vjs-volume-panel-vertical"><button class="vjs-mute-control vjs-control vjs-button vjs-vol-0" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Unmute</span></button><div class="vjs-volume-control vjs-control vjs-volume-vertical" style="max-height: 586.758px;"><div tabindex="0" class="vjs-volume-bar vjs-slider-bar vjs-slider vjs-slider-vertical" role="slider" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Volume" aria-live="polite" aria-valuetext="0%"><div class="vjs-mouse-display"><div class="vjs-volume-tooltip" aria-hidden="true"></div></div><div class="vjs-volume-level" style="height: 0%;"><span class="vjs-control-text"></span></div></div></div></div><button class="vjs-fullscreen-control vjs-control vjs-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Turn fullscreen on</span><div class="vjs-tooltip-container vjs-tooltip-right"><div class="vjs-tooltip" aria-hidden="true" role="tooltip">Fullscreen</div></div></button></div><div class="vjs-error-display vjs-modal-dialog vjs-hidden " tabindex="-1" aria-describedby="ember147_component_903_description" aria-hidden="true" aria-label="Modal window" role="dialog"><p class="vjs-modal-dialog-description vjs-control-text" id="ember147_component_903_description">Media player modal window</p><div class="vjs-modal-dialog-content" role="document"></div></div><div class="vjs-text-track-display" translate="yes" aria-live="off" aria-atomic="true"><div style="position: absolute; inset: 0px; margin: 1.5%;"></div></div><div class="vjs-modal-dialog vjs-hidden vjs-screen vjs-end-screen" tabindex="-1" aria-describedby="ember303_description" aria-hidden="true" aria-label="Modal window" role="dialog"><p class="vjs-modal-dialog-description vjs-control-text" id="ember303_description">Media player modal window This modal can be closed by pressing the Escape key or activating the close button.</p><div class="vjs-modal-dialog-content" role="document" id="ember303"></div><button class="vjs-close-button vjs-control vjs-button" type="button" aria-disabled="false"><span class="vjs-icon-placeholder" aria-hidden="true"></span><span class="vjs-control-text" aria-live="polite">Close modal window</span></button></div></div>

<!----></div>

<!---->    </div>
  
  
  
                      </div>
<!----><!----><!----><!---->    </div>
  
<!---->
<!---->
                      <!---->

                        <!---->

                  <!---->

<!---->
                    
    
    <div id="ember148" class="update-v2-social-activity
        
        ">
      
          
    <div class="social-details-social-counts social-details-social-counts--no-vertical-padding
        
        
        
        
        ">
      <div class="display-flex flex-grow-1 full-width">
        <div class="relative full-width">
          <ul class="display-flex flex-wrap">
              <li class="social-details-social-counts__item social-details-social-counts__reactions social-details-social-counts__item--height-two-x
                  social-details-social-counts__reactions--left-aligned
                  ">
                <button data-reaction-details="" aria-label="28 reactions" class="t-black--light display-flex align-items-center social-details-social-counts__count-value social-details-social-counts__count-value-hover
                    text-body-small
                    hoverable-link-text
                    " type="button">
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--0 reactions-icon__consumption--small data-test-reactions-icon-type-LIKE data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/8ekq8gho1ruaf8i7f86vd1ftt" alt="like" data-test-reactions-icon-type="LIKE" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
  
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--1 reactions-icon__consumption--small reactions-icon--stacked data-test-reactions-icon-type-EMPATHY data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/cpho5fghnpme8epox8rdcds22" alt="love" data-test-reactions-icon-type="EMPATHY" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
  
    <img class="reactions-icon social-detail-social-counts__count-icon social-detail-social-counts__count-icon--2 reactions-icon__consumption--small reactions-icon--stacked data-test-reactions-icon-type-INTEREST data-test-reactions-icon-theme-light" src="https://static.licdn.com/aero-v1/sc/h/lhxmwiwoag9qepsh4nc28zus" alt="insightful" data-test-reactions-icon-type="INTEREST" data-test-reactions-icon-theme="light" data-test-reactions-icon-style="consumption" data-test-reactions-icon-size="small">
                      <span aria-hidden="true" class="social-details-social-counts__reactions-count
                        ">
28                    </span>
                </button>
              </li>

              <li data-non-reaction-details="" class="display-flex flex-grow-1 max-full-width">
                <ul class="display-flex flex-grow-1 max-full-width">
                    <li class="social-details-social-counts__item social-details-social-counts__comments social-details-social-counts__item--height-two-x
                        social-details-social-counts__item--right-aligned
                        ">
                        <button aria-label="2 comments on Jeremy Harbour’s post" class="t-black--light social-details-social-counts__count-value social-details-social-counts__count-value-hover
                            text-body-small
                            hoverable-link-text
                            social-details-social-counts__btn
                            " type="button">
                          <span aria-hidden="true">
                              2 comments
                          </span>
                        </button>
                    </li>

                    <li class="social-details-social-counts__item social-details-social-counts__item--height-two-x flex-shrink-1 overflow-hidden
                        social-details-social-counts__item--right-aligned
                        ">
                        <button id="ember149" class="ember-view t-black--light social-details-social-counts__count-value-hover social-details-social-counts__item--truncate-text full-width
                            text-body-small
                            hoverable-link-text social-details-social-counts__btn
                            " aria-label="3 reposts of Jeremy Harbour’s post">
                          <span aria-hidden="true">
                            3 reposts
                          </span>
                        </button>
                    </li>

<!---->                </ul>
              </li>
          </ul>
        </div>
      </div>
    </div>
  

<!---->
<!---->
          
    <div class="feed-shared-social-action-bar
        
        feed-shared-social-action-bar--full-width
        
        feed-shared-social-action-bar--has-social-counts
        ">
      
<!---->              
    <span class="reactions-react-button feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
<!---->      <button aria-pressed="false" aria-label="React Like" id="ember151" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button react-button__trigger
          "><!---->
<span class="artdeco-button__text">
    
        <div class="flex-wrap justify-center
            artdeco-button__text align-items-center">
              <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="thumbs-up-outline-small">
<!---->    
    <use href="#thumbs-up-outline-small" width="16" height="16"></use>
</svg>


            <span aria-hidden="true" class="artdeco-button__text react-button__text social-action-button__text
                ">
              Like
            </span>
        </div>
      
</span></button>

      <button aria-label="Open reactions menu" aria-expanded="false" tabindex="0" id="ember152" class="artdeco-button artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view reactions-menu__trigger" data-finite-scroll-hotkey="l"><!---->
<span class="artdeco-button__text">
    
        <svg role="none" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="caret-small">
<!---->    
    <use href="#caret-small" width="16" height="16"></use>
</svg>

      
</span></button>
    </span>
  
              <span tabindex="-1" id="ember153" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
  <div>
    <button role="button" aria-label="Comment" tabindex="0" id="feed-shared-social-action-bar-comment-ember150" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button comment-button flex-wrap " data-finite-scroll-hotkey="c">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="comment-small">
<!---->    
    <use href="#comment-small" width="16" height="16"></use>
</svg>


<span class="artdeco-button__text">
    Comment
</span></button>
  </div>
  <div id="artdeco-gen-45" class="ember-view"><div id="ember156" class="ember-view"></div></div>
</span>
              
    <div id="ember157" class="artdeco-dropdown artdeco-dropdown--placement-bottom artdeco-dropdown--justification-right ember-view feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
      <span tabindex="-1" id="ember159" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view flex-1 display-flex">
        <button aria-expanded="false" aria-label="" tabindex="0" id="ember160" class="artdeco-dropdown__trigger artdeco-dropdown__trigger--placement-bottom ember-view 
            artdeco-button social-actions-button social-reshare-button flex-wrap
            artdeco-button--muted artdeco-button--3 artdeco-button--tertiary" data-finite-scroll-hotkey="r" type="button">
            <svg role="none" aria-hidden="true" class="artdeco-button__icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="repost-small">
<!---->    
    <use href="#repost-small" width="16" height="16"></use>
</svg>

            <span class="artdeco-button__text social-action-button__text">Repost</span>
        
<!----></button>

        <div tabindex="-1" aria-hidden="true" id="ember161" class="artdeco-dropdown__content artdeco-dropdown--is-dropdown-element artdeco-dropdown__content--justification-right artdeco-dropdown__content--placement-bottom ember-view social-reshare-button__share-dropdown-content"><!----></div>

        <div id="artdeco-gen-46" class="ember-view"><div id="ember163" class="ember-view"></div></div>
      </span>
        <div>
  
      
<!---->  
  
</div>

<!---->
<!---->    </div>
  
                <div class="feed-shared-social-action-bar__action-button feed-shared-social-action-bar--new-padding">
                  <span tabindex="-1" id="ember164" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top artdeco-hoverable-trigger--is-hoverable ember-view">
                    
    <button aria-label="Send in a private message" id="ember165" class="artdeco-button artdeco-button--muted artdeco-button--3 artdeco-button--tertiary ember-view social-actions-button send-privately-button flex-wrap
         send-privately-button" data-finite-scroll-hotkey="s" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" data-supported-dps="16x16" data-test-icon="send-privately-small" data-rtl="true">
<!---->    
    <use href="#send-privately-small" width="16" height="16"></use>
</svg>


<span class="artdeco-button__text">
    
        <span class="artdeco-button__text social-action-button__text">
          Send
        </span>
    
</span></button>
  
                    <div id="artdeco-gen-47" class="ember-view"><div id="ember167" class="ember-view"></div></div>
                  </span>
                </div>
<!----><!---->          
    </div>
  
<!----><!----><!---->    
    </div>
  
  
                  <!---->                </div>

                  
    
    <div id="ember168" class="update-v2-social-activity
        
        ">
      
<!----><!---->
<!---->
<!---->
          
<!---->                    

<!---->
          <div class="feed-shared-update-v2__comments-container display-flex flex-column
              ">
<!----><!---->          </div>
    
    </div>
  
  

<!---->
<!---->
<!---->
          
              </div>
          
      </div>
  
        </div>
      </div>
<!---->    </div>
<!---->  
        
  

<!---->      
  
    </div>
  
                    
</div>

                  </li>
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
                  
            </ul>
                
      </div>
    

<!---->
    <div>
  
        
        <div class="display-flex p5">
          <button id="ember301" class="artdeco-button artdeco-button--muted artdeco-button--1 artdeco-button--full artdeco-button--secondary ember-view scaffold-finite-scroll__load-button" type="button"><!---->
<span class="artdeco-button__text">
    Show more results
</span></button>
        </div>
    
    
</div>

</div>
  
                      
      </div>
  
      
    </div>
<!---->  
  

  
        
</section>

for each post, it should do the below:

and then simply click on 'Like' button.

after that, the idea is to click on 'more' button and then read the whole post and let gpt 5.6 luna read it. and then let the gpt 5.6 write a nice content, very short and direct to the post and click on 'comment' button and then the below will appear:
"<div class="feed-shared-update-v2__comments-container display-flex flex-column
              ">
              <div id="ember346" class="comments-comment-box--cr
    
    comments-comment-box--has-avatar
    
    
    
    " data-scroll-name="true">
      <div class="display-flex flex-1">
          
    <div class="feed-shared-avatar-image b0 member comments-comment-box__avatar-image--cr">
        <img src="https://media.licdn.com/dms/image/v2/C4D03AQEnGGdkaZxxLw/profile-displayphoto-shrink_800_800/profile-displayphoto-shrink_800_800/0/1617697491876?e=1787184000&amp;v=beta&amp;t=blkQZCWfl_U5W-91JRXol0f0nLHF86PPV4t4yDfw1qY" alt="Kshamta Poorun" id="ember347" class="avatar member EntityPhoto-circle-1 evi-image ember-view">
    </div>
  

<!---->        <form class="comments-comment-box__form">
          <div class="comments-comment-texteditor
              ">
            <div class="display-flex
                flex-wrap">
              <div class="comments-comment-box-comment__text-editor">
  
      
      
  
    <div>
<!---->        
    
    <div class="editor-container relative">
      <div>
        <div class="editor-content ql-container"><div class="ql-editor ql-blank" data-gramm="false" contenteditable="true" data-placeholder="Add a comment…" aria-placeholder="Add a comment…" aria-label="Text editor for creating content" role="textbox" aria-multiline="true" aria-describedby="ember357-text-editor-placeholder" data-test-ql-editor-contenteditable="true"><p><br></p></div><div class="ql-clipboard" contenteditable="true" tabindex="-1"></div></div>
          <span class="a11y-text" aria-hidden="true" id="ember357-text-editor-placeholder">
            Add a comment…
          </span>

<!---->      </div>
<!---->    </div>
  
  
    </div>
  

  
  
</div>
<!---->              <div class="display-flex justify-space-between">
                <div class="display-flex">
                    
      
                        
    <div>
      <span tabindex="-1" id="ember352" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top ember-view">
        <button title="Open Emoji Keyboard" aria-label="Open Emoji Keyboard" aria-expanded="false" aria-controls="artdeco-hoverable-comments_overlay_emoji__emoji-hoverable__content" id="ember353" class="comments-comment-box__emoji-picker-trigger emoji-hoverable-trigger artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view" data-reaction-summary__emoji-hoverable="" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" data-supported-dps="24x24" data-test-icon="emoji-medium">
<!---->    
    <use href="#emoji-medium" width="24" height="24"></use>
</svg>


<span class="artdeco-button__text">
    Open Emoji Keyboard
</span></button>
          
      </span>

        <div id="comments_overlay_emoji__emoji-hoverable__content" class="ember-view"><div id="ember355" class="ember-view"></div></div>
    </div>
  
                    
  
                    <div class="comments-comment-box__detour-container">
                        <button aria-label="Add a photo" id="ember349" class="comments-comment-box__detour-icons artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" data-supported-dps="24x24" data-test-icon="image-medium">
<!---->    
    <use href="#image-medium" width="24" height="24"></use>
</svg>


<span class="artdeco-button__text">
    
</span></button>
                    </div>
                </div>
                <div class="display-flex align-items-center">
<!----><!---->                </div>
              </div>
            </div>
          </div>
<!----><!---->        </form>
      </div>
  
    <!---->
</div>

<!---->
<!---->
<!---->              <div id="ember350" class="comments-comments-list
    ">
<!----><!---->
    <div class="comments-comment-list__container
        ">
<!---->    </div>
<!----></div>
          </div>"
		  
		  and it should write the comment and then this will appear:
		  "<form class="comments-comment-box__form">
          <div class="comments-comment-texteditor
              ">
            <div class="display-flex
                flex-column">
              <div class="comments-comment-box-comment__text-editor">
  
      
      
  
    <div>
<!---->        
    
    <div class="editor-container ">
      <div>
        <div class="editor-content ql-container"><div class="ql-editor" data-gramm="false" contenteditable="true" data-placeholder="Add a comment…" aria-placeholder="Add a comment…" aria-label="Text editor for creating content" role="textbox" aria-multiline="true" aria-describedby="ember357-text-editor-placeholder" data-test-ql-editor-contenteditable="true"><p>example</p></div><div class="ql-clipboard" contenteditable="true" tabindex="-1"></div></div>
<!---->
<!---->      </div>
<!---->    </div>
  
  
    </div>
  

  
  
</div>
<!---->              <div class="display-flex justify-space-between">
                <div class="display-flex">
                    
      
                        
    <div>
      <span tabindex="-1" id="ember352" class="artdeco-hoverable-trigger artdeco-hoverable-trigger--content-placed-top ember-view">
        <button title="Open Emoji Keyboard" aria-label="Open Emoji Keyboard" aria-expanded="false" aria-controls="artdeco-hoverable-comments_overlay_emoji__emoji-hoverable__content" id="ember353" class="comments-comment-box__emoji-picker-trigger emoji-hoverable-trigger artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view" data-reaction-summary__emoji-hoverable="" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" data-supported-dps="24x24" data-test-icon="emoji-medium">
<!---->    
    <use href="#emoji-medium" width="24" height="24"></use>
</svg>


<span class="artdeco-button__text">
    Open Emoji Keyboard
</span></button>
          
      </span>

        <div id="comments_overlay_emoji__emoji-hoverable__content" class="ember-view"><div id="ember355" class="ember-view"></div></div>
    </div>
  
                    
  
                    <div class="comments-comment-box__detour-container">
                        <button aria-label="Add a photo" id="ember349" class="comments-comment-box__detour-icons artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view" type="button">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" data-supported-dps="24x24" data-test-icon="image-medium">
<!---->    
    <use href="#image-medium" width="24" height="24"></use>
</svg>


<span class="artdeco-button__text">
    
</span></button>
                    </div>
                </div>
                <div class="display-flex align-items-center">
                    <button id="ember358" class="comments-comment-box__submit-button--cr artdeco-button artdeco-button--1 artdeco-button--primary ember-view"><!---->
<span class="artdeco-button__text">
    Comment
</span></button>
<!---->                </div>
              </div>
            </div>
          </div>
<!----><!---->        </form>" and then it should click on 'comment' button to comment its comment.

and do same for others.

but note, on the plugin, there should be a field where the user can configure the total of 'total post to engage per profile' so that if the user put 2, it should only engage with 2 post on https://www.linkedin.com/in/jeremyharbour/recent-activity/all/ for example. and also allow an option where the user can check/uncheck whether they want to validate the returned post reply from gpt 5.6 luna before clicking on comment button. that way, they can monitor first instead of fully auto commenting.

and then based on the status, it should mark it as engaged ofc.



to add a linkedin connection, the extension should go back to 'https://www.linkedin.com/in/jeremyharbour/' root folder and then:

then click on 'More' btn:
<div class="_1e5f23a7 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa _96f0e9a0 f059b78b"><div class="ce603282 _17e609e3 d4f2796c _54be7ece _610ad599 f059b78b"><div class="d4848df5 _1a5be57c ab436114 _795fa3f2 cab72baa _96f0e9a0 f119848c _5672d711 caa4373f f059b78b"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><div class="ce603282 a8c47b3d f119848c f059b78b" componentkey="6ba13a4f-f17c-4683-ac53-721881fcacaf"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2" type="button" componentkey="FollowButtonurn:li:fsd_followingState:urn:li:member:32135774_follow" aria-label="Follow Jeremy Harbour"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 _7929167d _9b19a5d9 d4dd59ef _50bbae47 _04c24398 _3e6b7cdc"><svg xmlns="http://www.w3.org/2000/svg" id="add-small" fill="currentColor" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="86" width="16" height="16" class="_64e7534f a06597d6 _91d0e6d7 dc59675b _6f36fc53 _4be38cda"><path d="M14 9H9v5H7V9H2V7h5V2h2v5h5z"></path></svg><div class="_7e9b05f0 _2a4c8bcf d8b7cf70"><span class="b2c99b15 bf77356a ad5a9224 efa24adc e0e9e0c2 _407217d6 _81242264 _6252962c _0b55d5fb _00860791 _7877aa9b _2df8cc80 b8c53f21 f5782087 d75d3b4f _28a90b18 _17e609e3 _1dbbb6ca"><span>Follow</span></span></div></span></button></div></div></div><div class="d4848df5 _1a5be57c ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2" type="button" componentkey="ca28c38e-19e0-4db3-bcef-31dd402f7638" aria-label="Save Jeremy’s as a lead in Sales Navigator"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 d54c2008 _9b19a5d9 d4dd59ef _50bbae47 _04c24398 dcd7ed49"><span class="b2c99b15 bf77356a ad5a9224 efa24adc e0e9e0c2 _407217d6 _81242264 _6252962c _0b55d5fb _00860791 _7877aa9b _7e9b05f0 _2a4c8bcf d8b7cf70 _1dbbb6ca">Save in Sales Navigator</span></span></button></div></div><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2" type="button" componentkey="bf41d336-8ac1-47b0-bf94-3e14ddab676c" aria-expanded="false"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 d54c2008 _3d6dfd66 d4dd59ef _50bbae47 _04c24398 b69d3e06"><span class="b2c99b15 bf77356a ad5a9224 efa24adc e0e9e0c2 _407217d6 _81242264 _6252962c _0b55d5fb _00860791 _7877aa9b _7e9b05f0 _2a4c8bcf d8b7cf70 _1dbbb6ca">More</span></span></button></div></div></div><div class="ce603282 _17e609e3 d4f2796c _14a957d0 f059b78b"><div class="_1e5f23a7 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 _17e609e3 _45ea2244 _5672d711 caa4373f f059b78b"><div class="d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa _96f0e9a0 _17e609e3 _952f5ba5 f059b78b"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><div class="_56826039 ce603282 a8c47b3d _45ea2244 _952f5ba5 _5af40e0e f059b78b" componentkey="36b782d7-8967-4d9e-add8-512a67e7f56a"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2 _967c2721 _45ea2244" type="button" componentkey="FollowButtonurn:li:fsd_followingState:urn:li:member:32135774_follow" aria-label="Follow Jeremy Harbour"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 _7929167d _9b19a5d9 d4dd59ef _50bbae47 _04c24398 _3e6b7cdc"><svg xmlns="http://www.w3.org/2000/svg" id="add-small" fill="currentColor" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="86" width="16" height="16" class="_64e7534f a06597d6 _91d0e6d7 dc59675b _6f36fc53 _4be38cda"><path d="M14 9H9v5H7V9H2V7h5V2h2v5h5z"></path></svg><div class="_7e9b05f0 _2a4c8bcf d8b7cf70"><span class="b2c99b15 bf77356a ad5a9224 efa24adc e0e9e0c2 _407217d6 _81242264 _6252962c _0b55d5fb _00860791 _7877aa9b _2df8cc80 b8c53f21 f5782087 d75d3b4f _28a90b18 _17e609e3 _1dbbb6ca"><span>Follow</span></span></div></span></button></div></div></div><div class="d4848df5 _1a5be57c ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2 _56826039 a8c47b3d _45ea2244 _952f5ba5 _5af40e0e" type="button" componentkey="71d987a5-7271-4d3e-86f0-4cc08c98eacc" aria-label="Save Jeremy’s as a lead in Sales Navigator"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 d54c2008 _9b19a5d9 d4dd59ef _50bbae47 _04c24398 dcd7ed49"><span class="b2c99b15 bf77356a ad5a9224 efa24adc e0e9e0c2 _407217d6 _81242264 _6252962c _0b55d5fb _00860791 _7877aa9b _7e9b05f0 _2a4c8bcf d8b7cf70 _1dbbb6ca">Save in Sales Navigator</span></span></button></div></div><div class="_59b3c0c2 f059b78b" data-display-contents="true"><button class="b033cbbe ccb76a24 b126aff8 a44a49cc _2a4c8bcf _76517446 _7b86a110 b144d755 _3003be44 _3129c03c _8f9d5f88 _861df0d7 _26d811e2" type="button" componentkey="9572d49c-7e2a-4984-8f28-d35aceac2f5b" aria-label="More" aria-expanded="false"><span class="_4670fb73 _5026a09d _56826039 _861df0d7 b126aff8 a44a49cc _8f9d5f88 _64b9a917 _8f028620 _76517446 _7b86a110 ee9d5691 c37be0d8 d54c2008 _3d6dfd66 _507eed4a d4dd59ef _50bbae47 _04c24398 b69d3e06 _2b46ce4d"><svg xmlns="http://www.w3.org/2000/svg" id="overflow-web-ios-small" fill="currentColor" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="383" width="16" height="16" class="_64e7534f a06597d6 _91d0e6d7 dc59675b _6f36fc53 _4be38cda" aria-hidden="true"><path d="M3 9.5A1.5 1.5 0 1 1 4.5 8 1.5 1.5 0 0 1 3 9.5M11.5 8A1.5 1.5 0 1 0 13 6.5 1.5 1.5 0 0 0 11.5 8m-5 0A1.5 1.5 0 1 0 8 6.5 1.5 1.5 0 0 0 6.5 8"></path></svg></span></button></div></div><div class="d4848df5 _1a5be57c ab436114 _7e8e00a2 cab72baa _96f0e9a0 _17e609e3 _952f5ba5 f059b78b"></div></div></div></div>

then this appear:
"<div class="bf8efa12 _9521ca22 d600e8ac c3b40212 _27dbbee9 _7b334e57 d2113024 _766baad6 _2aa3dfbc ef4649ac ce0fde9e f059b78b" popover="manual" tabindex="0" style="position: fixed; left: 0px; top: 0px; transform: translate(524.167px, 150.833px); max-height: 422.898px;"><div class="_1e5f23a7 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b" role="menu"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="https://www.linkedin.com/sales/people/ACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o,name,omNh/" target="_blank" componentkey="da4aeff1-1181-4e1c-a330-9a9a4f9ec391" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="da4aeff1-1181-4e1c-a330-9a9a4f9ec391"><svg xmlns="http://www.w3.org/2000/svg" id="logo-sales-navigator-medium" fill="none" aria-hidden="true" data-supported-dps="24x24" viewBox="0 0 24 24" data-token-id="860" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path fill="currentColor" fill-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2m0 1.875c4.48 0 8.125 3.645 8.125 8.125S16.48 20.125 12 20.125 3.875 16.48 3.875 12 7.52 3.875 12 3.875" clip-rule="evenodd"></path><path fill="currentColor" fill-rule="evenodd" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 .875c1.172 0 2.125.953 2.125 2.125A2.127 2.127 0 0 1 12 14.125 2.127 2.127 0 0 1 9.875 12c0-1.172.953-2.125 2.125-2.125" clip-rule="evenodd"></path><path fill="currentColor" fill-rule="evenodd" d="M16.99 7.64c0-.39-.271-.63-.632-.63-.098 0-.2.015-.302.061l-4.298 1.953C11.84 9.018 11.918 9 12 9c.622 0 1.199.189 1.677.512A3.01 3.01 0 0 1 15 12c0 .083-.018.161-.024.242l1.953-4.298a.7.7 0 0 0 .06-.304zm-6.667 6.848a3 3 0 0 1-1.087-1.32A3 3 0 0 1 9 12c0-.083.018-.161.025-.242l-1.953 4.297a.6.6 0 0 0-.062.258c0 .328.256.676.616.676a.8.8 0 0 0 .32-.06l4.296-1.953c-.081.007-.159.024-.242.024a3 3 0 0 1-1.677-.512" clip-rule="evenodd"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">View in Sales Navigator</p></div></div></a></div><div class="_59b3c0c2 f059b78b" data-display-contents="true"><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="/messaging/compose/?screenContext=NON_SELF_PROFILE_VIEW&amp;body=https%3A%2F%2Fwww.linkedin.com%2Fin%2Fjeremyharbour&amp;interop=msgOverlay" componentkey="1f4f189d-87ed-433c-a365-f3780557f241" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="1f4f189d-87ed-433c-a365-f3780557f241"><svg xmlns="http://www.w3.org/2000/svg" id="send-privately-medium" fill="currentColor" aria-hidden="true" data-rtl="true" data-supported-dps="24x24" viewBox="0 0 24 24" data-token-id="161" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path d="M21 3 0 10l7.66 4.26L16 8l-6.26 8.34L14 24z"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">Send profile in a message</p></div></div></a></div><div role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b"><svg xmlns="http://www.w3.org/2000/svg" id="download-medium" fill="currentColor" aria-hidden="true" data-supported-dps="24x24" viewBox="0 0 24 24" data-token-id="136" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path d="M21 14v5a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-5h2v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5zm-4-.57V11l-4 2.85V3h-2v10.85L7 11v2.43L12 17z"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">Save to PDF</p></div></div></div><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="/messaging/compose/?profileUrn=urn%3Ali%3Afsd_profile%3AACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o&amp;recipient=ACoAAAHqWl4B2atO522cbwmvvUx3n4ri_RRPo0o&amp;screenContext=NON_SELF_PROFILE_VIEW&amp;interop=msgOverlay" componentkey="a07563f4-6bdb-46cb-b296-b8ece84259c5" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="a07563f4-6bdb-46cb-b296-b8ece84259c5"><svg xmlns="http://www.w3.org/2000/svg" id="send-privately-medium" fill="currentColor" aria-hidden="true" data-rtl="true" data-supported-dps="24x24" viewBox="0 0 24 24" data-token-id="161" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path d="M21 3 0 10l7.66 4.26L16 8l-6.26 8.34L14 24z"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">Message Jeremy</p></div></div></a><div class="_59b3c0c2 f059b78b" data-display-contents="true"><div class="ce603282 _17e609e3 d4f2796c _2ca95035 f059b78b" componentkey="3e06a196-3fed-4b6e-9ad3-5d1d12904b0b"><div class="_59b3c0c2 f059b78b" data-display-contents="true"><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="/preload/custom-invite/?vanityName=jeremyharbour" componentkey="ConnectButtonstate:invitation:urn:li:member:32135774_connect" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="ConnectButtonstate:invitation:urn:li:member:32135774_connect" aria-label="Invite Jeremy Harbour to connect"><svg xmlns="http://www.w3.org/2000/svg" id="connect-small" fill="currentColor" aria-hidden="true" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="414" width="16" height="16" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path d="M9 4a3 3 0 1 1-3-3 3 3 0 0 1 3 3M6.75 8h-1.5A2.25 2.25 0 0 0 3 10.25V15h6v-4.75A2.25 2.25 0 0 0 6.75 8M13 8V6h-1v2h-2v1h2v2h1V9h2V8z"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">Connect</p></div></div></a></div></div></div><div class="_59b3c0c2 f059b78b" data-display-contents="true"><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="https://www.linkedin.com/preload/report-in-modal/?entityUrn=urn%3Ali%3Amember%3A32135774&amp;contentSource=PROFILE&amp;authorUrn=urn%3Ali%3Amember%3A32135774" componentkey="49c87308-e311-40b6-abcd-235f28f82695" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="49c87308-e311-40b6-abcd-235f28f82695"><svg xmlns="http://www.w3.org/2000/svg" id="report-medium" fill="currentColor" data-supported-dps="16x16" viewBox="0 0 16 16" data-token-id="156" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5" aria-hidden="true"><path d="M13 2.44v6.91l-1.2.45a3 3 0 0 1-2.17 0L7.8 9.11a3.1 3.1 0 0 0-1.09-.2 3.4 3.4 0 0 0-1.08.2L5 9.35V15H3V1h2v1.43l.63-.23A2.9 2.9 0 0 1 6.71 2a3.1 3.1 0 0 1 1.09.2l1.83.69a3.1 3.1 0 0 0 1.08.2 3.1 3.1 0 0 0 1.09-.2z"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">Report / Block</p></div></div></a></div><div class="_59b3c0c2 f059b78b" data-display-contents="true"><a role="menuitem" tabindex="-1" class="_45ea2244 _170beb9c b51c7b07 _537769e5 b54d46b8 _7a3ffd47 _1e2429b7 _1e430fe6 b126aff8 _2a4c8bcf b037d925 d4848df5" href="https://www.linkedin.com/in/jeremyharbour/" componentkey="c9e9a7c9-4289-4422-ad41-5c42c69afc29" data-tabindex="0"><div class="_56826039 _1db4e2aa _94514d81 _8ee633b0 _4156463f d4848df5 _1a5be57c ab436114 _861df0d7 cab72baa f1e44985 _170beb9c _2ca95035 f059b78b" componentkey="c9e9a7c9-4289-4422-ad41-5c42c69afc29"><svg xmlns="http://www.w3.org/2000/svg" id="signal-notice-medium" fill="currentColor" aria-hidden="true" data-supported-dps="24x24" viewBox="0 0 24 24" data-token-id="125" width="24" height="24" class="_64e7534f _9f211933 a06597d6 _3d3ea7e1 _0fa9f0fc d067f7d9 _952f5ba5"><path d="M18 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3V6a3 3 0 0 0-3-3m-4 15h-1a3 3 0 0 1-3-3 3.2 3.2 0 0 1 .1-.75L11.2 10h2.07L12 14.75A1 1 0 0 0 13 16h1zm-1-9.75A1.25 1.25 0 1 1 14.25 7 1.25 1.25 0 0 1 13 8.25"></path></svg><div class="_1e5f23a7 _56826039 d4848df5 _0d2437d8 ab436114 _795fa3f2 cab72baa f1e44985 f059b78b"><p class="b2c99b15 _6252962c ab0299f4 _7467519b _7e9b05f0 _76517446 ba2ce735 _35a84468 d8b7cf70 _4b3ac618">About this member</p></div></div></a></div></div></div>"

and then click on 'Connect' btn.

then this modal appear:
"<div id="artdeco-modal-outlet" tabindex="-1">    <div data-test-modal-container="" data-test-modal-id="send-invite-modal" aria-hidden="false" id="ember51" class="artdeco-modal-overlay artdeco-modal-overlay--layer-default artdeco-modal-overlay--is-top-layer  ember-view">
      <div data-test-modal="" role="dialog" tabindex="-1" class="artdeco-modal artdeco-modal--layer-default send-invite" size="medium" aria-labelledby="send-invite-modal">
        <span class="a11y-text">Dialog content start.</span>
            <button aria-label="Dismiss" id="ember52" class="artdeco-button artdeco-button--circle artdeco-button--muted artdeco-button--2 artdeco-button--tertiary ember-view artdeco-modal__dismiss" data-test-modal-close-btn="">        <svg role="none" aria-hidden="true" class="artdeco-button__icon " xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" data-supported-dps="24x24" data-test-icon="close-medium">
<!---->    
    <use href="#close-medium" width="24" height="24"></use>
</svg>


<span class="artdeco-button__text">
    
</span></button>
        

          <div id="ember53" class="artdeco-modal__header ember-view">
            <h2 id="send-invite-modal">
              Add a note to your invitation?
            </h2>
          
<!----></div>
<!---->          <div id="ember54" class="artdeco-modal__content ember-view">
<!----><!----><!---->

                <p class="display-flex">
                    <span class="flex-1">
                      Personalize your invitation to <strong>Jeremy Harbour</strong> by adding a note. LinkedIn members are more likely to accept invitations that include a note.
                    </span>
                </p>
<!---->
<!---->
          </div>
          <div id="ember55" class="artdeco-modal__actionbar ember-view text-align-right">
<!---->              <button aria-label="Add a note" id="ember56" class="artdeco-button artdeco-button--2 artdeco-button--secondary ember-view mr1"><!---->
<span class="artdeco-button__text">
    Add a note
</span></button>
                          <button aria-label="Send without a note" id="ember57" class="artdeco-button artdeco-button--2 artdeco-button--primary ember-view ml1"><!---->
<span class="artdeco-button__text">
    Send without a note
</span></button>
          </div>
              
        <span class="a11y-text">Dialog content end.</span>
      </div>
    </div>
</div>"

then we have 2 btns, simply click on 'send without a note'.