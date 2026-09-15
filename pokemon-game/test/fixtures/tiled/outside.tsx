<?xml version="1.0" encoding="UTF-8"?>
<tileset version="1.10" tiledversion="1.11.0" name="outside" tilewidth="16" tileheight="16" tilecount="4" columns="4">
 <image source="tiles.png" width="64" height="16"/>
 <tile id="0">
  <properties>
   <property name="name" value="grass"/>
   <property name="encounter" type="bool" value="true"/>
   <property name="terrainTag" type="int" value="2"/>
   <property name="footstep" value="soft"/>
   <property name="rarity" type="float" value="0.25"/>
  </properties>
 </tile>
 <tile id="1" type="wall">
  <properties>
   <property name="name" value="wall"/>
  </properties>
  <objectgroup draworder="index" id="2">
   <object id="1" x="0" y="0" width="16" height="16"/>
  </objectgroup>
 </tile>
 <tile id="2">
  <properties>
   <property name="name" value="water"/>
   <property name="bush" type="bool" value="true"/>
   <property name="ledge" value="down"/>
  </properties>
  <objectgroup draworder="index" id="2">
   <object id="1" x="0" y="0" width="16" height="3"/>
  </objectgroup>
  <animation>
   <frame tileid="2" duration="400"/>
   <frame tileid="3" duration="400"/>
  </animation>
 </tile>
 <tile id="3">
  <properties>
   <property name="name" value="water-b"/>
  </properties>
 </tile>
 <wangsets>
  <wangset name="Ground" type="edge" tile="-1">
   <wangcolor name="Grass" color="#58b848" tile="0" probability="1"/>
   <wangtile tileid="0" wangid="1,0,1,0,1,0,1,0"/>
  </wangset>
 </wangsets>
</tileset>
